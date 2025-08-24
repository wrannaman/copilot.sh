"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { createClient } from "@/utils/supabase/client";
import { useToast } from "@/components/toast-provider";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import SpreadsheetViewer from "@/components/questionnaire/spreadsheet-viewer";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Square } from "lucide-react";
import ExcelJS from "exceljs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { generateAnswer } from "@/lib/rag";

export default function QuestionnaireWorkbenchPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const { user, currentOrganization } = useAuth();
  const [loading, setLoading] = useState(true);
  const [questionnaire, setQuestionnaire] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [allDatasets, setAllDatasets] = useState([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState([]);
  const viewerRef = useRef(null);
  const [selectedRows, setSelectedRows] = useState([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editCells, setEditCells] = useState([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [questionRange, setQuestionRange] = useState(null); // {col, start, end}
  const [answerRange, setAnswerRange] = useState(null);
  const [selectionMode, setSelectionMode] = useState("question");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ total: 0, done: 0, cancelled: false });
  const [dirty, setDirty] = useState(false);
  const [activeSignedUrl, setActiveSignedUrl] = useState(null);
  const [activeFilename, setActiveFilename] = useState(null);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const autosaveRef = useRef(null); // unused now; kept for future
  const lastSavedHashRef = useRef(null); // unused now; kept for future
  const suppressDirtyRef = useRef(false);
  const [recentVersions, setRecentVersions] = useState([]);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      if (!id) return;
      const supabase = createClient();
      try {
        const { data, error } = await supabase
          .from("questionnaires")
          .select("id, name, status, original_file_name, original_file_path, created_at, selected_datasets")
          .eq("id", id)
          .single();
        if (error) throw error;
        if (isMounted) {
          setQuestionnaire(data);
          setSelectedDatasetIds(Array.isArray(data.selected_datasets) ? data.selected_datasets : []);
          console.log('[Workbench] Questionnaire metadata loaded, will load latest version');
        }
      } catch (err) {
        toast.error("Unable to load questionnaire", { description: err.message });
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    run();
    return () => {
      isMounted = false;
    };
  }, [id, toast]);

  useEffect(() => {
    const loadDatasets = async () => {
      if (!currentOrganization?.org_id) return;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("datasets")
        .select("id, name")
        .eq("organization_id", currentOrganization.org_id)
        .order("created_at", { ascending: false });
      if (error) {
        toast.error("Failed to load datasets", { description: error.message });
        return;
      }
      setAllDatasets(data || []);
    };
    loadDatasets();
  }, [currentOrganization?.org_id, toast]);

  // If there's exactly one dataset and none selected yet for this questionnaire, auto-select it for convenience
  useEffect(() => {
    if (!questionnaire) return;
    if (selectedDatasetIds.length > 0) return;
    if (allDatasets.length === 1) {
      const only = allDatasets[0];
      setSelectedDatasetIds([only.id]);
      persistSelectedDatasets([only.id]);
      toast.info('Dataset selected', { description: `${only.name} was auto-selected. You can change this anytime.` });
    }
  }, [questionnaire, allDatasets, selectedDatasetIds.length, toast]);

  const persistSelectedDatasets = async (ids) => {
    if (!id) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("questionnaires")
      .update({ selected_datasets: ids })
      .eq("id", id);
    if (error) {
      toast.error("Failed to save datasets", { description: error.message });
    } else {
      toast.success("Datasets saved");
    }
  };

  const handleToggleDataset = async (datasetId) => {
    const next = selectedDatasetIds.includes(datasetId)
      ? selectedDatasetIds.filter((d) => d !== datasetId)
      : [...selectedDatasetIds, datasetId];
    setSelectedDatasetIds(next);
    persistSelectedDatasets(next);
  };

  const handleStatusChange = async (newStatus) => {
    if (!id) return;
    setSavingStatus(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("questionnaires")
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) throw error;

      setQuestionnaire(prev => ({ ...prev, status: newStatus }));
      toast.success(`Status updated to ${newStatus}`);
    } catch (error) {
      toast.error("Failed to update status", { description: error.message });
    } finally {
      setSavingStatus(false);
    }
  };

  const openEditForSelectedRow = () => {
    if (!viewerRef.current || selectedRows.length !== 1) return;
    const r = selectedRows[0];
    const values = [];
    for (let c = 1; c <= 12; c++) {
      const val = viewerRef.current.getCellValue(r, c);
      values.push({ col: c, value: val });
    }
    setEditCells(values);
    setIsEditOpen(true);
  };

  const saveRowEdits = () => {
    if (!viewerRef.current) return;
    const r = selectedRows[0];
    editCells.forEach(({ col, value }) => viewerRef.current.setCellValue(r, col, value));
    setIsEditOpen(false);
    toast.success("Row updated");
  };

  const sendRowToAI = async () => {
    if (!viewerRef.current || !user) return;
    const r = selectedRows[0];
    const parts = [];
    for (let c = 1; c <= 12; c++) {
      const v = viewerRef.current.getCellValue(r, c);
      if (v && String(v).trim()) parts.push(String(v).trim());
    }
    const questionText = parts.join(" | ");
    try {
      setAiAnswer("");
      setAiOpen(true);
      const supabase = createClient();
      const selectedDatasets = allDatasets.filter(d => selectedDatasetIds.includes(d.id));
      const result = await generateAnswer(questionText, selectedDatasets, id, supabase, user.id);
      setAiAnswer(result?.answer || "");
    } catch (err) {
      toast.error("AI failed", { description: err.message });
    }
  };

  const selectedRowRange = () => {
    if (!selectedRows || selectedRows.length === 0) return null;
    const sorted = [...selectedRows].sort((a, b) => a - b);
    return { start: sorted[0], end: sorted[sorted.length - 1] };
  };

  const numberToLetters = (num) => {
    let letters = "";
    let n = num || 0;
    while (n > 0) {
      const rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  };

  const canSend = () => {
    return Boolean(
      questionRange && answerRange &&
      questionRange.col && answerRange.col &&
      questionRange.start != null && answerRange.start != null &&
      (questionRange.end - questionRange.start) === (answerRange.end - answerRange.start) &&
      selectedDatasetIds.length > 0
    );
  };

  const hashRows = (rows) => {
    try {
      let h = 2166136261 >>> 0;
      const maxRows = Math.min(rows.length, 500);
      for (let r = 0; r < maxRows; r++) {
        const cells = rows[r]?.cells || [];
        const maxCols = Math.min(cells.length, 200);
        for (let c = 0; c < maxCols; c++) {
          const v = String(cells[c]?.value ?? '');
          for (let i = 0; i < v.length; i++) {
            h ^= v.charCodeAt(i);
            h = (h * 16777619) >>> 0;
          }
          h ^= 31; // delimiter
        }
        h ^= 127;
      }
      return h.toString(16);
    } catch (_) {
      return String(Date.now());
    }
  };

  const saveVersion = async () => {
    try {
      const rows = viewerRef.current?.getRows?.() || []
      const sheetName = viewerRef.current?.getActiveSheetName?.() || undefined
      const payload = { rows, sheetName, basePath: activeFilePath, filename: `${questionnaire?.name || 'questionnaire'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx` }
      const res = await fetch(`/api/questionnaires/${id}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('Save failed')
      const json = await res.json()
      console.log('[Workbench] saveVersion success, updating filename reference only', { version: json.version, path: json.path, filename: json.filename })

      // Only update the filename for UI display purposes - keep the same signed URL to avoid reload
      // The data in the viewer is already correct (it's what we just saved)
      setActiveFilename(json.filename)
      setActiveFilePath(json.path)
      setDirty(false)
      toast.success('Saved version', { description: json.version })

      // Wait a bit for the file to be fully written to storage before refreshing versions
      setTimeout(() => {
        refreshVersions()
      }, 1000)
    } catch (e) {
      toast.error('Save failed', { description: e.message })
    }
  };

  const handleRowsChange = useCallback((rows) => {
    console.log('[Workbench] onRowsChange fired. rows=', Array.isArray(rows) ? rows.length : 'n/a')
    if (suppressDirtyRef.current) {
      console.log('[Workbench] onRowsChange suppressed (programmatic load)')
      suppressDirtyRef.current = false
      setDirty(false)
      return
    }
    setDirty(true)
  }, [])

  // Load latest version ONLY (but only on initial load, not after saves)
  useEffect(() => {
    const loadLatest = async () => {
      if (!id || loading || !questionnaire || activeFilename) return; // Don't auto-load if we already have a filename set
      const supabase = createClient();
      try {
        const prefix = `questionnaires/${id}/versions/`;
        const { data, error } = await supabase.storage.from('secreq').list(prefix, { limit: 100 });
        if (error) throw error;
        const items = (data || []).filter(f => f.name.endsWith('.xlsx')).sort((a, b) => b.name.localeCompare(a.name));
        const latest = items[0];
        if (!latest) {
          // Fallback: first-time upload, no versions yet → load original upload
          if (!questionnaire?.original_file_path) {
            throw new Error('No saved versions or original file path found');
          }
          const { data: sig, error: sigErr } = await supabase.storage
            .from('secreq')
            .createSignedUrl(questionnaire.original_file_path, 60 * 15);
          if (sigErr) throw sigErr;
          console.log('[Workbench] No versions yet; loading original upload', questionnaire.original_file_name);
          suppressDirtyRef.current = true;
          setActiveSignedUrl(sig?.signedUrl || null);
          setActiveFilename(questionnaire.original_file_name);
          setActiveFilePath(questionnaire.original_file_path);
          setDirty(false);
          setTimeout(() => { suppressDirtyRef.current = false }, 1200);
          return;
        }
        const { data: sig, error: sigErr } = await supabase.storage.from('secreq').createSignedUrl(prefix + latest.name, 60 * 15);
        if (sigErr) throw sigErr;
        console.log('[Workbench] Initial auto-load of latest version', latest.name);
        suppressDirtyRef.current = true;
        setActiveSignedUrl(sig?.signedUrl || null);
        setActiveFilename(latest.name);
        setActiveFilePath(prefix + latest.name);
        setDirty(false);
        setTimeout(() => { suppressDirtyRef.current = false }, 1200);
      } catch (e) {
        toast.error('Failed to load latest version', { description: e.message });
      }
    };
    loadLatest();
  }, [id, loading, questionnaire, toast, activeFilename]);

  const refreshVersions = async () => {
    try {
      const supabase = createClient();
      const prefix = `questionnaires/${id}/versions/`;
      const { data, error } = await supabase.storage.from('secreq').list(prefix, { limit: 100 });
      if (error) throw error;
      const items = (data || []).filter(f => f.name.endsWith('.xlsx')).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 10);
      setRecentVersions(items.map(f => ({ name: f.name, path: prefix + f.name })));
      try {
        const names = (items || []).map(f => f.name)
        console.log('[Workbench] refreshVersions', { count: names.length, latest: names[0] || null, all: names })
      } catch (_) { }
    } catch (e) {
      // silent
    }
  };

  useEffect(() => { if (id) refreshVersions(); }, [id]);

  // Prompt before leaving if there are unsaved changes
  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const buildContextForRow = (rowIndex) => {
    // Build question string from question range cell, plus header and section context
    const questionCell = viewerRef.current?.getCellValue(rowIndex, questionRange.col) || '';
    const headerRow = 1; // simple heuristic; could be improved using spreadsheet-viewer metadata
    const header = viewerRef.current?.getCellValue(headerRow, questionRange.col) || '';
    // Try to capture the left-most non-empty heading in same row as a section label (heuristic)
    let section = '';
    for (let c = 1; c < questionRange.col; c++) {
      const val = viewerRef.current?.getCellValue(rowIndex, c);
      if (val && String(val).trim().length > 0) { section = val; break; }
    }
    // Include the entire source row cells to give RAG richer context
    const rowCells = [];
    for (let c = 1; c <= Math.min(20, 512); c++) {
      rowCells.push(viewerRef.current?.getCellValue(rowIndex, c) || '');
    }
    return { questionText: String(questionCell || '').trim(), header, section, rowCells };
  };

  const sendBatchToAI = async () => {
    if (!canSend() || !user) return;
    const supabase = createClient();
    const selectedDatasets = allDatasets.filter(d => selectedDatasetIds.includes(d.id));
    const start = questionRange.start;
    const end = questionRange.end;
    const count = end - start + 1;
    setIsProcessing(true);
    setProgress({ total: count, done: 0, cancelled: false });

    const indices = Array.from({ length: count }, (_, i) => start + i);
    const BATCH = 5;
    for (let i = 0; i < indices.length; i += BATCH) {
      if (progress.cancelled) break;
      const chunk = indices.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (rowIndex) => {
        const ctx = buildContextForRow(rowIndex);
        const rowLines = ctx.rowCells
          .map((v, idx) => `${idx + 1}. ${String(v || '').trim()}`)
          .filter(line => line.replace(/^\d+\.\s*/, '').trim().length > 0)
          .join('\n');
        const prompt = `You are drafting an answer on behalf of our company for a third‑party security questionnaire.\n${ctx.section ? `Section: ${ctx.section}\n` : ''}${ctx.header ? `Header: ${ctx.header}\n` : ''}\n${rowLines ? `Row Context (cells):\n${rowLines}\n\n` : ''}Question (from questionnaire): ${ctx.questionText}\n\nInstructions:\n- Answer as the supplier ("we") — do not answer as the AI or the platform.\n- Be concise (1–3 sentences) and specific.\n- Base the answer on the provided context and common security practices.\n- If the context suggests multiple parts (e.g., Yes/No and Comments), provide the narrative response suitable for the Response/Comments column.`;
        try {
          const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              organizationId: currentOrganization?.org_id,
              datasetIds: selectedDatasetIds,
              queryText: ctx.questionText,
            })
          });
          const json = await res.json();
          const answer = json.answer || json.text || '';
          // Write to spreadsheet answer cell
          viewerRef.current?.setCellValue(rowIndex, answerRange.col, answer);
        } catch (err) {
          // Leave cell unchanged on error
        } finally {
          setProgress(prev => ({ ...prev, done: Math.min(prev.total, prev.done + 1) }));
        }
      }));
    }
    setIsProcessing(false);
    setSendDialogOpen(false);
    // Give the UI a moment to paint updated cells before snapshotting
    await new Promise((r) => setTimeout(r, 400));
    // Auto-save a new version after AI completes
    await saveVersion();
    // Clear selections after successful processing
    viewerRef.current?.clearSelections?.();
    setQuestionRange(null);
    setAnswerRange(null);
    setSelectionMode('question');
    setSelectedRows([]);
    toast.success('AI processing completed ✅', { description: 'Document was saved automatically' });
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <main className="container mx-auto px-10 py-3 max-w-full max-h-full">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading questionnaire…</p>
            </div>
          ) : !questionnaire ? (
            <Card className="max-w-3xl mx-auto">
              <CardContent className="p-12 text-center">
                <p className="text-muted-foreground">Unable to load questionnaire.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Workbench</CardTitle>
                  <CardDescription>{questionnaire.name}</CardDescription>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Datasets:</span>
                    {allDatasets.length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      allDatasets.map(ds => {
                        const selected = selectedDatasetIds.includes(ds.id)
                        return (
                          <Button
                            key={ds.id}
                            size="sm"
                            variant={selected ? "default" : "outline"}
                            className="h-7 px-2 text-xs"
                            onClick={() => handleToggleDataset(ds.id)}
                            title={selected ? "Selected" : "Click to select"}
                          >
                            {ds.name}
                            {selected && <Badge variant="secondary" className="ml-1 text-[10px]">✔</Badge>}
                          </Button>
                        )
                      })
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Status:</span>
                    <Select
                      value={questionnaire?.status || 'draft'}
                      onValueChange={handleStatusChange}
                      disabled={savingStatus}
                    >
                      <SelectTrigger className="h-7 px-2 text-xs w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="needs_review">Needs Review</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      {/* <CardTitle>Original File Preview</CardTitle> */}
                      <CardDescription>
                        <span className="ml-3 text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : ''}</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 px-2 ml-2">Versions</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
                            {recentVersions.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-muted-foreground">No versions</div>
                            ) : (
                              recentVersions.map(v => {
                                const isActive = activeFilename === v.name
                                return (
                                  <DropdownMenuItem
                                    key={v.name}
                                    className={isActive ? 'bg-blue-50 dark:bg-blue-950/20 font-medium' : ''}
                                    onClick={async () => {
                                      try {
                                        const supabase = createClient();
                                        const { data: sig, error } = await supabase.storage.from('secreq').createSignedUrl(v.path, 60 * 15)
                                        if (error) throw error
                                        console.log('[Workbench] Loading version from dropdown', v.name)
                                        suppressDirtyRef.current = true
                                        setActiveSignedUrl(sig?.signedUrl || null)
                                        setActiveFilename(v.name)
                                        setActiveFilePath(v.path)
                                        setDirty(false)
                                        toast.success('Loaded version', { description: v.name })
                                      } catch (e) {
                                        toast.error('Failed to load version', { description: e.message })
                                      }
                                    }}
                                  >
                                    <div className="flex items-center justify-between w-full">
                                      <span>{v.name}</span>
                                      {isActive && <span className="text-blue-600 dark:text-blue-400 text-xs">●</span>}
                                    </div>
                                  </DropdownMenuItem>
                                )
                              })
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="outline" size="sm" className="h-7 px-2 ml-2" onClick={saveVersion}>Save Version</Button>

                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Button size="sm" variant={selectionMode === 'question' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setSelectionMode('question')}>Select Questions</Button>
                      <Button size="sm" variant={selectionMode === 'answer' ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setSelectionMode('answer')}>Select Answers</Button>
                      {/* <Button size="sm" variant="outline" className="h-7 px-2 ml-2" onClick={loadLatestSnapshot}>Load Latest Snapshot</Button> */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2"
                        onClick={async () => {
                          try {
                            const rows = viewerRef.current?.getRows?.() || []
                            const sheetName = viewerRef.current?.getActiveSheetName?.() || undefined
                            const res = await fetch(`/api/questionnaires/${id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, sheetName, basePath: activeFilePath, filename: `${questionnaire.name || 'questionnaire'}-export.xlsx` }) })
                            if (!res.ok) throw new Error('Export failed')
                            const blob = await res.blob()
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${questionnaire.name || 'questionnaire'}-export.xlsx`
                            document.body.appendChild(a)
                            a.click()
                            URL.revokeObjectURL(url)
                            a.remove()
                            toast.success('Exported .xlsx')
                          } catch (e) {
                            toast.error('Export failed', { description: e.message })
                          }
                        }}
                      >
                        Export Excel
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Gate viewer until at least one dataset is selected to make the requirement clear */}
                  {selectedDatasetIds.length === 0 ? (
                    <div className="border rounded p-6 bg-muted/30 text-sm text-muted-foreground">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">⚠️</div>
                        <div>
                          <div className="text-foreground font-medium">Select a dataset to enable AI</div>
                          <div className="mt-1">Choose one or more datasets above. We use your datasets to draft answers with citations.</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <SpreadsheetViewer
                      ref={viewerRef}
                      signedUrl={activeSignedUrl}
                      filename={activeFilename || questionnaire.original_file_name}
                      selectionMode={selectionMode}
                      onSelectionChange={setSelectedRows}
                      onRowsChange={handleRowsChange}
                      onRangeSelect={(range) => {
                        if (!range) { setQuestionRange(null); setAnswerRange(null); return; }
                        if (range.mode === 'question') {
                          setQuestionRange(range);
                          setSelectionMode('answer');
                          toast.info('Now select the answer range', { description: 'Pick the destination cells for the AI answers.' });
                        }
                        if (range.mode === 'answer') setAnswerRange(range);
                      }}
                      highlightRanges={{ question: questionRange, answer: answerRange }}
                      onClearSelections={() => { setQuestionRange(null); setAnswerRange(null); setSelectionMode('question'); }}
                    />
                  )}
                  <div className="mt-3 flex items-center flex-wrap gap-3 text-xs">
                    {selectedRowRange() && (
                      <div className="px-2 py-1 border border-muted rounded bg-muted">
                        Rows: {`${selectedRowRange().start}–${selectedRowRange().end}`}
                      </div>
                    )}
                    <div className={`px-2 py-1 border border-muted rounded ${questionRange ? 'bg-blue-50 dark:bg-blue-950/20' : 'bg-muted'}`}>
                      Q Range: {questionRange ? `${numberToLetters(questionRange.col)}${questionRange.start}–${numberToLetters(questionRange.col)}${questionRange.end}` : '—'}
                    </div>
                    <div className={`px-2 py-1 border border-muted rounded ${answerRange ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-muted'}`}>
                      A Range: {answerRange ? `${numberToLetters(answerRange.col)}${answerRange.start}–${numberToLetters(answerRange.col)}${answerRange.end}` : '—'}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {(questionRange || answerRange || selectedRowRange()) && (
                        <Button size="sm" variant="outline" onClick={() => { viewerRef.current?.clearSelections?.(); }}>Clear</Button>
                      )}
                      {(() => {
                        const ready = canSend();
                        const mismatch = !!(questionRange && answerRange && ((questionRange.end - questionRange.start) !== (answerRange.end - answerRange.start)));
                        return (
                          <>
                            {selectedDatasetIds.length === 0 && (
                              <span className="text-xs text-destructive mr-2">Select at least one dataset to enable AI</span>
                            )}
                            {mismatch && (
                              <span className="text-xs text-destructive mr-2">Ranges must be the same length</span>
                            )}
                            <Button
                              onClick={() => setSendDialogOpen(true)}
                              disabled={!ready}
                              className={`${ready ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/30 animate-[pulse_2s_ease-in-out_infinite]' : 'bg-muted text-muted-foreground'} h-9 px-4`}
                            >
                              <Sparkles className="h-4 w-4 mr-2" />
                              Send to AI
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={saveVersion}
                              className="ml-2 h-9"
                            >
                              Save Version
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const rows = viewerRef.current?.getRows?.() || []
                                  const sheetName = viewerRef.current?.getActiveSheetName?.() || undefined
                                  const res = await fetch(`/api/questionnaires/${id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, sheetName, basePath: activeFilePath, filename: `${questionnaire.name || 'questionnaire'}-export.xlsx` }) })
                                  if (!res.ok) throw new Error('Export failed')
                                  const blob = await res.blob()
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = `${questionnaire.name || 'questionnaire'}-export.xlsx`
                                  document.body.appendChild(a)
                                  a.click()
                                  URL.revokeObjectURL(url)
                                  a.remove()
                                  toast.success('Exported .xlsx')
                                } catch (e) {
                                  toast.error('Export failed', { description: e.message })
                                }
                              }}
                              className="h-9"
                            >
                              Export Excel
                            </Button>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Current file status */}
                  <div className="mt-4 pt-3 border-t text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>Currently loaded:</span>
                      <span className="font-mono text-xs">
                        {activeFilename || questionnaire?.original_file_name || 'Loading...'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-base">Edit Row {selectedRows[0]}</DialogTitle>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    {editCells.map((cell) => (
                      <div key={cell.col} className="space-y-1">
                        <div className="text-[11px] text-muted-foreground">Col {cell.col}</div>
                        <Textarea
                          value={cell.value || ""}
                          onChange={(e) => setEditCells(prev => prev.map(c => c.col === cell.col ? { ...c, value: e.target.value } : c))}
                          className="min-h-16 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button size="sm" onClick={saveRowEdits}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={aiOpen} onOpenChange={setAiOpen}>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-base">AI Answer</DialogTitle>
                  </DialogHeader>
                  <Textarea readOnly value={aiAnswer} className="min-h-32 text-sm" />
                </DialogContent>
              </Dialog>

              {/* Send to AI Summary (front-end only) */}
              <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-base">Confirm Send to AI</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2 text-sm">
                    <div>Question range: <strong>{questionRange ? `${numberToLetters(questionRange.col)}${questionRange.start}–${numberToLetters(questionRange.col)}${questionRange.end}` : '—'}</strong></div>
                    <div>Answer range: <strong>{answerRange ? `${numberToLetters(answerRange.col)}${answerRange.start}–${numberToLetters(answerRange.col)}${answerRange.end}` : '—'}</strong></div>
                    <div>
                      Datasets: <strong>{allDatasets.filter(d => selectedDatasetIds.includes(d.id)).map(d => d.name).join(', ') || '—'}</strong>
                    </div>
                    <div className="text-muted-foreground">This will batch the selected questions and place answers into the chosen answer range.</div>
                  </div>
                  <DialogFooter>
                    <Button size="sm" variant="secondary" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
                    <Button size="sm" disabled={!canSend()} onClick={() => { setSendDialogOpen(false); sendBatchToAI(); }}>Send</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {isProcessing && (
                <div className="fixed top-20 left-0 right-0 z-40">
                  <div className="mx-auto container px-10">
                    <div className="flex items-center gap-3 p-3 border rounded bg-background/95 backdrop-blur">
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Generating answers… {progress.done}/{progress.total}</div>
                        <div className="w-full h-2 bg-muted rounded mt-1 overflow-hidden">
                          <div className="h-full bg-blue-600" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setProgress(p => ({ ...p, cancelled: true })); setIsProcessing(false); }}>
                        <Square className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}


