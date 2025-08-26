"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
// removed Progress and Slider (RMS UI removed)
import { Mic, Square } from "lucide-react";
import { useToast } from "@/components/toast-provider";

// --- Tunables ---
const WINDOW_MS = 10000;       // 10s window
const STEP_MS = 10000;         // emit every 10s → no overlap
const ENDPOINT = "/api/transcribe"; // POST target
const MIN_EMIT_GAP_MS = STEP_MS; // rate-limit emits to avoid flooding

export default function RecordPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <div className="container mx-auto max-w-3xl py-8">
          <RecordContent />
        </div>
      </div>
    </AuthGuard>
  );
}

function RecordContent() {
  const { toast } = useToast();

  // UI state
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("idle");
  // RMS UI removed
  const [recentTranscripts, setRecentTranscripts] = useState([]); // last 10 transcripts

  // Media + analysis - initialize with proper values to avoid type issues
  const streamRef = useRef(/** @type {MediaStream | null} */(null));
  const recRef = useRef(/** @type {MediaRecorder | null} */(null));

  // Timing
  const recStartEpochRef = useRef(/** @type {number} */(0));   // performance.now() at start
  const seqRef = useRef(/** @type {number} */(0));

  // Timers
  const schedulerTimerRef = useRef(/** @type {number | null} */(null)); // unused with continuous recorder; kept for safety

  // ---- helpers ----
  function chooseMime() {
    const cands = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];
    return cands.find((t) => MediaRecorder.isTypeSupported(t));
  }

  // RMS sampling removed

  // ---- core ----
  async function start() {
    if (isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      // AudioContext/Analyser removed (no RMS)

      // reset clocks and per-window recorders
      windowRecordersRef.current.forEach(w => { try { w.rec.stop(); } catch { } if (w.stopId) clearTimeout(w.stopId); });
      windowRecordersRef.current = [];
      seqRef.current = 0;
      recStartEpochRef.current = performance.now();

      const mime = chooseMime();

      function startWindowRecorder() {
        const startHi = performance.now() - recStartEpochRef.current;
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

        rec.ondataavailable = async (ev) => {
          if (!ev.data || ev.data.size === 0) return;
          // Single self-contained window blob (MediaRecorder provides proper headers)
          const seq = seqRef.current++;
          console.log(`Sending window ${seq}, size: ${ev.data.size}`);

          const form = new FormData();
          form.append("chunk", ev.data, `chunk-${String(seq).padStart(6, "0")}.webm`);
          form.append("seq", String(seq));
          form.append("windowStartMs", String(Math.round(startHi)));
          form.append("windowEndMs", String(Math.round(performance.now() - recStartEpochRef.current)));
          form.append("stepMs", String(STEP_MS));
          form.append("windowMs", String(WINDOW_MS));

          try {
            console.log(`Posting to ${ENDPOINT}...`);
            const res = await fetch(ENDPOINT, { method: "POST", body: form });
            console.log(`Response status: ${res.status} ${res.statusText}`);
            const responseData = await res.text();
            console.log(`Upload success for window ${seq}:`, responseData);
            try {
              const data = JSON.parse(responseData);
              if (data.text && data.text.trim()) {
                const transcript = {
                  seq,
                  text: data.text.trim(),
                  timestamp: new Date().toLocaleTimeString(),
                };
                setRecentTranscripts(prev => [...prev.slice(-9), transcript]);
                toast.success(`Chunk #${seq}: "${data.text}"`);
              } else {
                toast.info(`Chunk #${seq}: (silence)`);
              }
            } catch { }
          } catch (e) {
            console.error('upload failed:', e?.message || e);
            toast.error(`Upload failed for chunk #${seq}`, { description: e?.message || String(e) });
          }
        };

        rec.start(WINDOW_MS);
        const stopId = window.setTimeout(() => {
          try { rec.stop(); } catch { }
        }, WINDOW_MS);
        windowRecordersRef.current.push({ rec, stopId, startHi });
      }

      // schedule rolling window recorders every STEP_MS
      if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current);
      startWindowRecorder();
      schedulerTimerRef.current = window.setInterval(() => {
        startWindowRecorder();
      }, STEP_MS);

      // RMS meter removed

      setIsRecording(true);
      setStatus("recording");
      toast.success("Recording started");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("start() failed:", message);
      toast.error(`Recording failed: ${message}`);
      setStatus("error");
      stop();
    }
  }

  function stop() {
    if (!isRecording) return;

    setIsRecording(false);
    setStatus("idle");
    // Flush the final window synchronously before tearing down
    try { void emitWindow(true); } catch { }
    toast.info("Recording stopped");

    // Stop all window recorders
    try {
      windowRecordersRef.current.forEach(w => { try { w.rec.stop(); } catch { } if (w.stopId) clearTimeout(w.stopId); });
    } catch { }
    windowRecordersRef.current = [];

    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { }
    streamRef.current = null;

    if (schedulerTimerRef.current) { clearInterval(schedulerTimerRef.current); schedulerTimerRef.current = null; }

    fragsRef.current = [];
  }

  useEffect(() => () => stop(), []);

  // Flush current window when the page is hidden or user navigates away
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && isRecording) {
        // let any active recorder emit by stopping them now
        try { windowRecordersRef.current.forEach(w => { try { w.rec.stop(); } catch { } }); } catch { }
      }
    }
    function onPageHide() {
      if (isRecording) {
        try { windowRecordersRef.current.forEach(w => { try { w.rec.stop(); } catch { } }); } catch { }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [isRecording]);

  async function emitWindow(force = false) {
    const nowLogical = logicalClockRef.current;
    const winStart = Math.max(0, nowLogical - WINDOW_MS);
    const winEnd = nowLogical;

    // rate limit to avoid emitting more often than STEP_MS unless forced
    if (!force && (nowLogical - lastEmitLogicalRef.current) < MIN_EMIT_GAP_MS) {
      return;
    }

    const fr = fragsRef.current;
    if (!fr.length) return;

    const within = fr.filter((f) => f.t1 > winStart && f.t0 < winEnd);
    if (!within.length) return;

    console.log(`Window info: using ${within.length} fragments - SENDING`);

    const type = recRef.current?.mimeType || within[0].blob.type || "audio/webm";
    const blobs = headerBlobRef.current ? [headerBlobRef.current, ...within.map((f) => f.blob)] : within.map((f) => f.blob);
    const blobSizes = blobs.map(b => b.size);
    console.log(`Creating window blob from ${blobs.length} fragments:`, blobSizes);
    const windowBlob = new Blob(blobs, { type });

    // high-res end ≈ last fragment hiEnd; start = end - WINDOW_MS
    const hiEnd = within[within.length - 1].hiEnd;
    const hiStart = Math.max(0, hiEnd - WINDOW_MS);

    const seq = seqRef.current++;
    console.log(`Sending chunk ${seq}, size: ${windowBlob.size}`);
    toast.info(`Sending chunk #${seq}`, { description: `Size: ${Math.round(windowBlob.size / 1024)} KB` });

    const form = new FormData();
    form.append("chunk", windowBlob, `chunk-${String(seq).padStart(6, "0")}.webm`);
    form.append("seq", String(seq));
    form.append("windowStartMs", String(Math.round(hiStart)));
    form.append("windowEndMs", String(Math.round(hiEnd)));
    // no RMS in payload
    form.append("stepMs", String(STEP_MS));
    form.append("windowMs", String(WINDOW_MS));

    try {
      // mark last emit on attempt to send
      lastEmitLogicalRef.current = nowLogical;
      console.log(`Posting to ${ENDPOINT}...`);
      const res = await fetch(ENDPOINT, { method: "POST", body: form });
      console.log(`Response status: ${res.status} ${res.statusText}`);

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`HTTP ${res.status}: ${errorText}`);
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const responseData = await res.text();
      console.log(`Upload success for chunk ${seq}:`, responseData);

      // Parse and store transcript
      try {
        const data = JSON.parse(responseData);
        if (data.text && data.text.trim()) {
          const transcript = {
            seq,
            text: data.text.trim(),
            timestamp: new Date().toLocaleTimeString(),
            // no RMS kept
          };
          setRecentTranscripts(prev => [...prev.slice(-9), transcript]); // keep last 10
          toast.success(`Chunk #${seq}: "${data.text}"`);
        } else {
          toast.info(`Chunk #${seq}: (silence)`);
        }
      } catch (parseError) {
        console.error('Failed to parse response:', parseError);
        toast.success(`Chunk #${seq} uploaded successfully`);
      }
    } catch (e) {
      // non-fatal
      const message = e?.message || e;
      console.error("upload failed:", message);
      toast.error(`Upload failed for chunk #${seq}`, { description: message });
    }
  }

  // ---- UI ----
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recorder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {status === "recording" ? (
              <span className="inline-flex items-center gap-2 text-green-600">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                Recording
              </span>
            ) : status === "error" ? (
              <span className="inline-flex items-center gap-2 text-red-600">Error occurred</span>
            ) : (
              <span className="text-muted-foreground">Idle</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isRecording ? (
              <Button onClick={start} size="icon" className="h-16 w-16 rounded-full sm:h-20 sm:w-20">
                <Mic className="h-7 w-7 sm:h-8 sm:w-8" />
              </Button>
            ) : (
              <Button onClick={stop} size="icon" variant="destructive" className="h-16 w-16 rounded-full sm:h-20 sm:w-20">
                <Square className="h-7 w-7 sm:h-8 sm:w-8" />
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Sends 10s windows. All audio is captured for meeting recording.
          </div>
        </div>

        {/* Recent Transcripts Display */}
        {recentTranscripts.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Recent Transcripts</Label>
            <div className="space-y-1 p-3 bg-muted/50 rounded-md">
              {recentTranscripts.slice(-10).map((transcript) => (
                <div key={transcript.seq} className="text-sm">
                  <span className="text-xs text-muted-foreground">#{transcript.seq} {transcript.timestamp}</span>
                  <div className="pl-2 text-foreground">{transcript.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
