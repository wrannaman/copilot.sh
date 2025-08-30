"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";

export default function SessionsPanel({ organizationId }) {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [retryingSession, setRetryingSession] = useState(null);

  useEffect(() => {
    async function loadSessions() {
      if (!organizationId) return;
      setSessionsLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('sessions')
        .select('id,title,status,created_at,transcript_storage_path')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && Array.isArray(data)) {
        setSessions(data);
      }
      setSessionsLoading(false);
    }
    loadSessions();
  }, [organizationId]);

  async function openTranscript(session) {
    setSelectedSession(session);
    setTranscriptText("");
    setTranscriptLoading(true);
    setTranscriptOpen(true);
    try {
      const supabase = createClient();
      let text = "";
      if (session?.transcript_storage_path) {
        const { data: fileData, error } = await supabase.storage
          .from('copilot.sh')
          .download(session.transcript_storage_path);
        if (!error && fileData) {
          text = await fileData.text();
        }
      }
      if (!text) {
        const { data: chunks, error: chunksError } = await supabase
          .from('session_chunks')
          .select('content')
          .eq('session_id', session.id)
          .order('created_at', { ascending: true })
          .limit(1000);
        if (!chunksError && Array.isArray(chunks) && chunks.length) {
          text = chunks.map(c => c.content).join("\n");
        }
      }
      setTranscriptText(text || "No transcript available yet.");
    } catch (_) {
      setTranscriptText("Failed to load transcript.");
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcriptText || "");
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

  async function pollSessionStatus(sessionId) {
    const maxAttempts = 30; // Poll for up to 1 minute
    let attempts = 0;

    const poll = async () => {
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
              setTimeout(poll, 2000);
            }
          }
        }
      } catch (error) {
        console.error('Error polling session status:', error);
      }
    };

    setTimeout(poll, 1000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Your recent recordings</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
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
                    <TableCell className="font-medium">{s.title || 'Untitled'}</TableCell>
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
                        <Button variant="outline" size="sm" onClick={() => openTranscript(s)}>View Transcript</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedSession?.title || 'Transcript'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Session ID: {selectedSession?.id}</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyTranscript} disabled={transcriptLoading}>Copy</Button>
              </div>
            </div>
            <Textarea
              className="min-h-[300px]"
              value={transcriptLoading ? 'Loading…' : (transcriptText || '')}
              readOnly
            />
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


