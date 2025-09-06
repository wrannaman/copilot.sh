"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SessionsPanel({ organizationId }) {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [retryingSession, setRetryingSession] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsSummary, setDetailsSummary] = useState(null);
  const [detailsTranscript, setDetailsTranscript] = useState("");
  const [availableTags, setAvailableTags] = useState([]);
  const [sessionTagsMap, setSessionTagsMap] = useState({}); // session_id -> [{id,name}]
  const [tagInputMap, setTagInputMap] = useState({}); // session_id -> current input value
  const isUnmountedRef = useRef(false);
  const pollTimeoutRef = useRef(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const loadSessions = useCallback(async () => {
    if (!organizationId) return;
    const supabase = createClient();
    const pageSize = 10;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize; // request one extra to detect next page
    const { data, error } = await supabase
      .from('sessions')
      .select('id,title,status,created_at,transcript_storage_path')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .range(startIndex, endIndex);
    if (!error && Array.isArray(data)) {
      const hasMore = data.length > pageSize;
      setHasNextPage(hasMore);
      setSessions(hasMore ? data.slice(0, pageSize) : data);
    }
  }, [organizationId, page]);

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      await loadSessions();
    } finally {
      setSessionsLoading(false);
    }
  }, [loadSessions]);

  useEffect(() => {
    if (!organizationId) return;
    setSessionsLoading(true);
    loadSessions().finally(() => setSessionsLoading(false));
    return () => { /* no-op mount effect cleanup */ };
  }, [organizationId, page, loadSessions]);

  // Load available tags and session tag joins for current page
  useEffect(() => {
    const run = async () => {
      if (!organizationId || sessions.length === 0) { setAvailableTags([]); setSessionTagsMap({}); return; }
      const supabase = createClient();
      // org tags
      const [{ data: tags }] = await Promise.all([
        supabase.from('tags').select('id,name').eq('organization_id', organizationId).order('name_ci', { ascending: true })
      ]);
      setAvailableTags(Array.isArray(tags) ? tags : []);
      // session tags for this page
      const sessionIds = sessions.map(s => s.id);
      const { data: joins } = await supabase
        .from('session_tags')
        .select('session_id, tag_id, tags!inner(id,name)')
        .in('session_id', sessionIds);
      const map = {};
      for (const j of (joins || [])) {
        const sid = j.session_id;
        if (!map[sid]) map[sid] = [];
        if (j.tags) map[sid].push({ id: j.tags.id, name: j.tags.name });
      }
      setSessionTagsMap(map);
    };
    run();
  }, [organizationId, sessions]);

  async function toggleTag(sessionId, tag) {
    const supabase = createClient();
    const tagsForSession = sessionTagsMap[sessionId] || [];
    const exists = tagsForSession.some(t => t.id === tag.id);
    if (exists) {
      // remove
      const { data } = await supabase
        .from('session_tags')
        .select('id')
        .eq('session_id', sessionId)
        .eq('tag_id', tag.id)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        await supabase.from('session_tags').delete().eq('id', data.id);
        setSessionTagsMap(prev => ({
          ...prev,
          [sessionId]: (prev[sessionId] || []).filter(t => t.id !== tag.id)
        }));
      }
    } else {
      await supabase.from('session_tags').insert({ session_id: sessionId, tag_id: tag.id });
      setSessionTagsMap(prev => ({
        ...prev,
        [sessionId]: [ ...(prev[sessionId] || []), { id: tag.id, name: tag.name } ]
      }));
    }
  }

  async function createAndAttachTag(sessionId, name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    const supabase = createClient();
    // try find existing
    const { data: existing } = await supabase
      .from('tags')
      .select('id,name')
      .eq('organization_id', organizationId)
      .ilike('name', clean)
      .limit(1)
      .maybeSingle();
    let tagId, tagName;
    if (existing?.id) {
      tagId = existing.id; tagName = existing.name;
    } else {
      const { data: created, error } = await supabase
        .from('tags')
        .insert({ organization_id: organizationId, name: clean })
        .select('id,name')
        .single();
      if (error) return;
      tagId = created.id; tagName = created.name;
      setAvailableTags(prev => [{ id: tagId, name: tagName }, ...prev]);
    }
    await supabase.from('session_tags').insert({ session_id: sessionId, tag_id: tagId });
    setSessionTagsMap(prev => ({
      ...prev,
      [sessionId]: [ ...(prev[sessionId] || []), { id: tagId, name: tagName } ]
    }));
  }

  function setTagInput(sessionId, value) {
    setTagInputMap(prev => ({ ...prev, [sessionId]: value }));
  }

  async function commitTagsInput(sessionId, raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    // Split by commas or whitespace/newline; strip leading '#'
    const parts = text
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .flatMap(s => s.split(/\s+/))
      .map(s => s.replace(/^#+/, ''))
      .filter(Boolean);
    for (const p of parts) {
      // Skip duplicates already on session
      const existing = (sessionTagsMap[sessionId] || []).some(t => t.name.toLowerCase() === p.toLowerCase());
      if (!existing) {
        await createAndAttachTag(sessionId, p);
      }
    }
    setTagInput(sessionId, '');
  }

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Reset to first page when org changes
    setPage(1);
  }, [organizationId]);

  // Open by query param (?open=ID)
  useEffect(() => {
    const toOpen = searchParams?.get('open');
    if (!toOpen || !Array.isArray(sessions) || sessions.length === 0) return;
    const s = sessions.find(x => String(x.id) === String(toOpen));
    if (s) {
      openDetails(s);
    }
  }, [searchParams, sessions]);

  async function openTranscript(session) {
    setSelectedSession(session);
    setTranscriptText("");
    setTranscriptLoading(true);
    setTranscriptOpen(true);
    try {
      const supabase = createClient();
      let text = "";
      // Prefer server API to get diarized/log-like transcript
      try {
        const resp = await fetch(`/api/sessions/${session.id}/transcript`)
        if (resp.ok) {
          text = await resp.text()
        }
      } catch { }
      // As last resort, read flat storage directly (rare)
      if (!text && session?.transcript_storage_path) {
        const { data: fileData, error } = await supabase.storage
          .from('copilot.sh')
          .download(session.transcript_storage_path);
        if (!error && fileData) {
          text = await fileData.text();
        }
      }
      setTranscriptText(text || "No transcript available yet.");
    } catch (_) {
      setTranscriptText("Failed to load transcript.");
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function openDetails(session) {
    if (!session || session.status !== 'ready') return;
    setSelectedSession(session);
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsSummary(null);
    setDetailsTranscript("");
    // Push query param for deep-linking
    try { router.push(`/sessions?open=${session.id}`); } catch { }
    try {
      // Fetch transcript from API (diarized/log-style if available)
      try {
        const resp = await fetch(`/api/sessions/${session.id}/transcript`)
        if (resp.ok) {
          setDetailsTranscript(await resp.text())
        } else {
          setDetailsTranscript("No transcript available yet.")
        }
      } catch {
        setDetailsTranscript("Failed to load transcript.")
      }

      // Generate/fetch summary
      try {
        const resp = await fetch(`/api/sessions/${session.id}/summarize`, { method: 'POST' })
        if (resp.ok) {
          const json = await resp.json()
          setDetailsSummary({
            summary: json?.summary || '',
            action_items: Array.isArray(json?.action_items) ? json.action_items : [],
            topics: Array.isArray(json?.topics) ? json.topics : []
          })
        } else {
          setDetailsSummary({ summary: '', action_items: [], topics: [] })
        }
      } catch {
        setDetailsSummary({ summary: '', action_items: [], topics: [] })
      }
    } finally {
      setDetailsLoading(false);
    }
  }

  async function copyDetailsTranscript() {
    try { await navigator.clipboard.writeText(detailsTranscript || "") } catch { }
  }
  async function copyDetailsSummary() {
    try {
      const s = detailsSummary?.summary || ''
      const ai = Array.isArray(detailsSummary?.action_items) && detailsSummary.action_items.length
        ? `\n\nAction items:\n- ${detailsSummary.action_items.join('\n- ')}`
        : ''
      const tp = Array.isArray(detailsSummary?.topics) && detailsSummary.topics.length
        ? `\n\nTopics:\n- ${detailsSummary.topics.join('\n- ')}`
        : ''
      const all = `${s}${ai}${tp}`.trim()
      await navigator.clipboard.writeText(all)
    } catch { }
  }

  async function retrySession(sessionId) {
    setRetryingSession(sessionId);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Update the session status to 'uploaded' (processing)
        setSessions(prevSessions =>
          prevSessions.map(session =>
            session.id === sessionId
              ? { ...session, status: 'uploaded' }
              : session
          )
        );

        // Poll for status updates
        pollSessionStatus(sessionId);
      } else {
        console.error('Failed to retry session:', response.statusText);
      }
    } catch (error) {
      console.error('Error retrying session:', error);
    } finally {
      setRetryingSession(null);
    }
  }

  function startEdit(session) {
    setEditingId(session.id)
    setEditingTitle(session.title || '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingTitle('')
  }

  async function saveTitle(sessionId) {
    if (!editingTitle && editingTitle !== '') return cancelEdit()
    setSavingId(sessionId)
    const newTitle = editingTitle.trim().slice(0, 200)
    // optimistic update
    setSessions(prev => prev.map(x => x.id === sessionId ? { ...x, title: newTitle || null } : x))
    try {
      const resp = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      })
      if (!resp.ok) {
        // revert on error
        await loadSessions()
      }
    } catch (_) {
      await loadSessions()
    } finally {
      setSavingId(null)
      cancelEdit()
    }
  }

  async function pollSessionStatus(sessionId) {
    const maxAttempts = 30; // Poll for up to 1 minute
    let attempts = 0;

    const poll = async () => {
      if (isUnmountedRef.current) return;
      try {
        const response = await fetch(`/api/sessions/${sessionId}/status`);
        if (response.ok) {
          const data = await response.json();

          setSessions(prevSessions =>
            prevSessions.map(session =>
              session.id === sessionId
                ? { ...session, status: data.status }
                : session
            )
          );

          // Continue polling if still processing
          if (data.status === 'uploaded' || data.status === 'transcribing') {
            attempts++;
            if (attempts < maxAttempts) {
              if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
              pollTimeoutRef.current = setTimeout(poll, 2000);
            }
          }
        }
      } catch (error) {
        console.error('Error polling session status:', error);
      }
    };

    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = setTimeout(poll, 1000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Your recent recordings</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshSessions}
            disabled={sessionsLoading}
          >
            {sessionsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionsLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">No sessions yet.</TableCell>
                </TableRow>
              ) : (
                sessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            className="border rounded px-2 py-1 text-sm w-full max-w-[360px]"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveTitle(s.id)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                          />
                          <button
                            className="inline-flex items-center justify-center h-8 w-8 rounded border text-xs"
                            aria-label="Save"
                            onClick={() => saveTitle(s.id)}
                            disabled={savingId === s.id}
                          >
                            ✓
                          </button>
                          <button
                            className="inline-flex items-center justify-center h-8 w-8 rounded border text-xs"
                            aria-label="Cancel"
                            onClick={cancelEdit}
                            disabled={savingId === s.id}
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          className="text-left hover:underline"
                          onClick={() => startEdit(s)}
                          title="Click to edit title"
                        >
                          {s.title || 'Untitled'}
                        </button>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(sessionTagsMap[s.id] || []).map((t) => (
                          <Badge
                            key={t.id}
                            variant="outline"
                            className="cursor-pointer"
                            onClick={() => toggleTag(s.id, t)}
                          >
                            #{t.name}
                          </Badge>
                        ))}
                        <input
                          className="border rounded px-1 py-0.5 text-xs w-32"
                          placeholder="add tag"
                          value={tagInputMap[s.id] || ''}
                          onChange={(e) => setTagInput(s.id, e.target.value)}
                          onKeyDown={(e) => {
                            const val = String(tagInputMap[s.id] || '').trim();
                            if ((e.key === 'Enter' || e.key === 'Tab' || e.key === ',') && val) {
                              e.preventDefault();
                              commitTagsInput(s.id, tagInputMap[s.id]);
                            } else if (e.key === 'Backspace' && !val) {
                              // remove last tag quickly
                              const tags = sessionTagsMap[s.id] || [];
                              const last = tags[tags.length - 1];
                              if (last) toggleTag(s.id, last);
                            }
                          }}
                          onPaste={(e) => {
                            const text = e.clipboardData.getData('text');
                            if (text && /[,\n\s]/.test(text)) {
                              e.preventDefault();
                              commitTagsInput(s.id, text);
                            }
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell>{new Date(s.created_at).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{s.status}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {s.status === 'error' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retrySession(s.id)}
                            disabled={retryingSession === s.id}
                          >
                            {retryingSession === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            {retryingSession === s.id ? 'Retrying...' : 'Retry'}
                          </Button>
                        )}
                        {s.status === 'ready' && (
                          <Button size="sm" onClick={() => openDetails(s)}>View Details</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">10 per page</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={sessionsLoading || page === 1}
            >
              Previous
            </Button>
            <div className="text-sm text-muted-foreground">Page {page}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={sessionsLoading || !hasNextPage}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>

      {/* Transcript-only dialog removed */}

      <Dialog
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) {
            // Clear query param back to /sessions
            try { router.replace('/sessions'); } catch { }
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedSession?.title || 'Session Details'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-muted-foreground">Summary</div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={copyDetailsSummary} disabled={detailsLoading}>Copy Summary</Button>
                </div>
              </div>
              {detailsLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : detailsSummary && (detailsSummary.summary || (detailsSummary.action_items?.length || detailsSummary.topics?.length)) ? (
                <div className="space-y-3">
                  {detailsSummary.summary ? (
                    <div className="whitespace-pre-wrap leading-relaxed text-sm">{detailsSummary.summary}</div>
                  ) : null}
                  {Array.isArray(detailsSummary.action_items) && detailsSummary.action_items.length > 0 ? (
                    <div>
                      <div className="font-medium text-sm mb-1">Action items</div>
                      <ul className="list-disc pl-5 space-y-1 text-sm">
                        {detailsSummary.action_items.map((it, idx) => (
                          <li key={idx}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {Array.isArray(detailsSummary.topics) && detailsSummary.topics.length > 0 ? (
                    <div>
                      <div className="font-medium text-sm mb-1">Topics</div>
                      <div className="flex flex-wrap gap-2">
                        {detailsSummary.topics.map((t, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded border text-xs">{t}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No summary yet.</div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-muted-foreground">Transcript</div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={copyDetailsTranscript} disabled={detailsLoading}>Copy Transcript</Button>
                </div>
              </div>
              <Textarea className="min-h-[240px]" value={detailsLoading ? 'Loading…' : (detailsTranscript || '')} readOnly />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


