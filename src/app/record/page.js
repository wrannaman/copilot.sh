"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
// removed Progress and Slider (RMS UI removed)
import { Mic, Square } from "lucide-react";
import { useToast } from "@/components/toast-provider";

// --- Tunables ---
const WINDOW_MS = 10000;       // 10s window
const STEP_MS = 10000;         // emit every 10s → no overlap
const ENDPOINT = "/api/transcribe"; // POST target
// emitWindow path removed; using per-window recorders only

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
  const [devices, setDevices] = useState(/** @type {Array<MediaDeviceInfo>} */([]));
  const [selectedDeviceId, setSelectedDeviceId] = useState("default");
  const [inUseLabel, setInUseLabel] = useState("");
  const [useBrowserTranscription, setUseBrowserTranscription] = useState(true);
  const [interimText, setInterimText] = useState("");

  // Media + analysis - initialize with proper values to avoid type issues
  const streamRef = useRef(/** @type {MediaStream | null} */(null));
  const recRef = useRef(/** @type {MediaRecorder | null} */(null));
  // Per-window MediaRecorders for rolling windows
  const windowRecordersRef = useRef(/** @type {Array<{ rec: MediaRecorder, stopId: number | null, startHi: number }>} */([]));
  const recognitionRef = useRef(/** @type {any} */(null));

  // Timing
  const recStartEpochRef = useRef(/** @type {number} */(0));   // performance.now() at start
  const seqRef = useRef(/** @type {number} */(0));

  // Timers
  const schedulerTimerRef = useRef(/** @type {number | null} */(null)); // unused with continuous recorder; kept for safety

  // ---- helpers ----
  function chooseMime() {
    // Prefer OGG/Opus; Google STT handles it more reliably than WebM/Opus
    const cands = [
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    return cands.find((t) => MediaRecorder.isTypeSupported(t));
  }

  // RMS sampling removed

  // Environment capability helpers
  function isMediaAvailable() {
    return !!(navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function isEnumerateAvailable() {
    return !!(navigator && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices);
  }
  function getSpeechCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  // ---- pipeline helpers ----
  function stopCloudPipeline(flush) {
    try {
      if (windowRecordersRef.current && windowRecordersRef.current.length) {
        windowRecordersRef.current.forEach((w) => {
          try { if (flush) w.rec.requestData?.(); } catch { }
          try { w.rec.stop(); } catch { }
          if (w.stopId) clearTimeout(w.stopId);
        });
      }
    } catch { }
    windowRecordersRef.current = [];
    if (schedulerTimerRef.current) { clearInterval(schedulerTimerRef.current); schedulerTimerRef.current = null; }
  }

  function startCloudPipeline(stream) {
    const mime = chooseMime();
    function startWindowRecorder() {
      const startHi = performance.now() - recStartEpochRef.current;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        const seq = seqRef.current++;
        console.log(`[CLOUD] Sending window ${seq}, size: ${ev.data.size}`);
        const form = new FormData();
        const ext = (rec.mimeType || mime || "").includes("ogg") ? "ogg" : "webm";
        form.append("chunk", ev.data, `chunk-${String(seq).padStart(6, "0")}.${ext}`);
        form.append("seq", String(seq));
        form.append("windowStartMs", String(Math.round(startHi)));
        form.append("windowEndMs", String(Math.round(performance.now() - recStartEpochRef.current)));
        form.append("stepMs", String(STEP_MS));
        form.append("windowMs", String(WINDOW_MS));
        form.append("mimeType", rec.mimeType || mime || "");
        try {
          console.log(`[CLOUD] Posting to ${ENDPOINT}...`);
          const res = await fetch(ENDPOINT, { method: "POST", body: form });
          console.log(`[CLOUD] Response status: ${res.status} ${res.statusText}`);
          const responseData = await res.text();
          console.log(`[CLOUD] Upload success for window ${seq}:`, responseData);
          try {
            const data = JSON.parse(responseData);
            if (data.text && data.text.trim()) {
              const transcript = { seq, text: data.text.trim(), timestamp: new Date().toLocaleTimeString() };
              setRecentTranscripts((prev) => [...prev.slice(-9), transcript]);
            }
          } catch { }
        } catch (e) {
          console.error('[CLOUD] upload failed:', e?.message || e);
        }
      };
      rec.start(WINDOW_MS);
      const stopId = window.setTimeout(() => { try { rec.stop(); } catch { } }, WINDOW_MS);
      windowRecordersRef.current.push({ rec, stopId, startHi });
    }
    // schedule
    if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current);
    startWindowRecorder();
    schedulerTimerRef.current = window.setInterval(() => { startWindowRecorder(); }, STEP_MS);
  }

  function stopBrowserPipeline() {
    try { recognitionRef.current?.stop?.(); } catch { }
    recognitionRef.current = null;
  }

  function startBrowserPipeline() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[STT] Web Speech API not available');
      return;
    }
    const recog = new SR();
    recognitionRef.current = recog;
    recog.lang = 'en-US';
    recog.continuous = true;
    recog.interimResults = true;
    console.log('[STT] init recognizer');
    recog.onresult = async (ev) => {
      console.log('[STT] onresult fired', { resultIndex: ev.resultIndex, length: ev.results.length });
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        console.log('[STT] result', { isFinal: res.isFinal, transcript: res[0]?.transcript });
        if (res.isFinal) {
          const text = res[0]?.transcript?.trim();
          if (text) {
            const seq = seqRef.current++;
            const form = new FormData();
            form.append('text', text);
            form.append('seq', String(seq));
            form.append('mode', 'browser');
            try {
              const r = await fetch(ENDPOINT, { method: 'POST', body: form });
              const body = await r.text();
              setRecentTranscripts(prev => [...prev.slice(-9), { seq, text, timestamp: new Date().toLocaleTimeString() }]);
              console.log('Browser STT sent', { seq, text, status: r.status, body });
            } catch (e) {
              console.warn('[STT] send failed', e);
            }
            setInterimText("");
          }
        } else {
          const partial = res[0]?.transcript?.trim() || "";
          setInterimText(partial);
        }
      }
    };
    recog.onerror = (e) => {
      const code = e?.error || 'unknown';
      console.warn('[STT] error', code);
    };
    recog.onend = () => {
      console.log('[STT] onend');
      if (isRecording && useBrowserTranscription) {
        try { recog.start(); } catch (e) { console.warn('[STT] restart failed', e); }
      }
    };
    try { console.log('[STT] start'); recog.start(); } catch (e) { console.warn('[STT] start failed', e); }
  }

  // Enumerate mics on mount and when devices change (prime permission to reveal labels)
  useEffect(() => {
    let cancelled = false;
    async function primeAndEnumerate() {
      if (!isMediaAvailable()) {
        console.warn('[MEDIA] getUserMedia not available on this browser');
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        try { s.getTracks().forEach(t => t.stop()); } catch { }
      } catch (e) {
        console.warn('[MEDIA] permission prime failed', e);
      }
      if (!isEnumerateAvailable()) {
        console.warn('[MEDIA] enumerateDevices not available');
        return;
      }
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const mics = all.filter(d => d.kind === 'audioinput');
        const dedup = Array.from(new Map(mics.map(d => [d.deviceId, d])).values());
        if (!cancelled) setDevices(dedup);
      } catch (e) {
        console.warn('[MEDIA] enumerateDevices failed', e);
      }
    }
    primeAndEnumerate();
    const onDevChange = () => { void primeAndEnumerate(); };
    try { navigator.mediaDevices.addEventListener('devicechange', onDevChange); } catch { }
    return () => { cancelled = true; try { navigator.mediaDevices.removeEventListener('devicechange', onDevChange); } catch { } };
  }, []);

  // ---- core ----
  async function start() {
    if (isRecording) return;

    try {
      if (!isMediaAvailable()) {
        throw new Error('getUserMedia not supported in this browser');
      }
      const constraints = selectedDeviceId && selectedDeviceId !== 'default'
        ? { audio: { deviceId: { exact: selectedDeviceId }, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const mics = all.filter(d => d.kind === 'audioinput');
        const dedup = Array.from(new Map(mics.map(d => [d.deviceId, d])).values()).filter(d => d.deviceId !== 'default');
        setDevices(dedup);
      } catch { }

      // track which label is in use
      try {
        const audioTrack = stream.getAudioTracks()[0];
        const settings = audioTrack.getSettings();
        const match = devices.find(d => d.deviceId === (settings.deviceId || selectedDeviceId));
        setInUseLabel(match?.label || audioTrack.label || "");
      } catch { }

      // AudioContext/Analyser removed (no RMS)

      // reset clocks and per-window recorders
      windowRecordersRef.current.forEach(w => { try { w.rec.stop(); } catch { } if (w.stopId) clearTimeout(w.stopId); });
      windowRecordersRef.current = [];
      seqRef.current = 0;
      recStartEpochRef.current = performance.now();

      // schedule rolling window recorders every STEP_MS (cloud mode only)
      if (!useBrowserTranscription) {
        startCloudPipeline(stream);
      } else {
        stopCloudPipeline(false);
      }

      // Optional: start in-browser transcription via Web Speech API
      if (useBrowserTranscription) {
        try {
          const SR = getSpeechCtor();
          if (SR) {
            const recog = new SR();
            recognitionRef.current = recog;
            recog.lang = 'en-US';
            recog.continuous = true;
            recog.interimResults = true;
            console.log('[STT] init recognizer');
            recog.onresult = async (ev) => {
              console.log('[STT] onresult fired', { resultIndex: ev.resultIndex, length: ev.results.length });
              for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const res = ev.results[i];
                console.log('[STT] result', { isFinal: res.isFinal, transcript: res[0]?.transcript });
                if (res.isFinal) {
                  const text = res[0]?.transcript?.trim();
                  if (text) {
                    const seq = seqRef.current++;
                    const form = new FormData();
                    form.append('text', text);
                    form.append('seq', String(seq));
                    form.append('mode', 'browser');
                    try {
                      const r = await fetch(ENDPOINT, { method: 'POST', body: form });
                      const body = await r.text();
                      setRecentTranscripts(prev => [...prev.slice(-9), { seq, text, timestamp: new Date().toLocaleTimeString() }]);
                      console.log('Browser STT sent', { seq, text, status: r.status, body });
                    } catch (e) {
                      console.warn('[STT] send failed', e);
                    }
                    setInterimText("");
                  }
                } else {
                  const partial = res[0]?.transcript?.trim() || "";
                  setInterimText(partial);
                }
              }
            };
            recog.onerror = (e) => {
              const code = e?.error || 'unknown';
              console.warn('[STT] error', code);
              if (code === 'network' || code === 'not-allowed' || code === 'service-not-allowed') {
                toast.error('Browser transcription unavailable. Falling back to cloud.');
                try { recog.stop(); } catch { }
                recognitionRef.current = null;
                // turn off browser mode; cloud upload continues
                setUseBrowserTranscription(false);
              }
            };
            recog.onend = () => {
              // Auto-restart if still recording and browser mode still on
              console.log('[STT] onend');
              if (isRecording && useBrowserTranscription && recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) { console.warn('[STT] restart failed', e); }
              }
            };
            try { console.log('[STT] start'); recog.start(); } catch (e) { console.warn('[STT] start failed', e); }
          } else {
            console.warn('[STT] Web Speech API not available');
          }
        } catch { }
      }

      // RMS meter removed

      setIsRecording(true);
      setStatus("recording");
      toast.success("Recording started" + (inUseLabel ? ` (${inUseLabel})` : ""));
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
    // Stop recorders to flush any in-flight windows
    toast.info("Recording stopped");

    // Stop all window recorders
    stopCloudPipeline(true);

    // Stop browser recognition if running
    stopBrowserPipeline();

    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { }
    streamRef.current = null;

    if (schedulerTimerRef.current) { clearInterval(schedulerTimerRef.current); schedulerTimerRef.current = null; }
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

  // emitWindow removed; using per-window recorders only

  // ---- UI ----
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recorder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {useBrowserTranscription && interimText && (
          <div className="rounded-md border p-2 text-sm">
            <span className="text-muted-foreground">Live:</span> {interimText}
          </div>
        )}
        {/* Microphone selector */}
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground">Microphone</Label>
          <Select value={selectedDeviceId} onValueChange={(v) => setSelectedDeviceId(v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={inUseLabel || "Default input"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key="default" value="default">Default</SelectItem>
              {devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Transcription mode */}
        <div className="flex items-center gap-3">
          <Label className="text-sm text-muted-foreground">Browser transcription</Label>
          <Switch
            checked={useBrowserTranscription}
            onCheckedChange={(v) => {
              // Seamless mode switch while recording: tear down and restart pipeline
              if (isRecording) {
                console.log('[MODE] switching', v ? 'browser' : 'cloud');
                // Stop both pipelines just in case
                stopCloudPipeline(true);
                stopBrowserPipeline();
                setUseBrowserTranscription(v);
                // Restart chosen pipeline with the same stream
                const s = streamRef.current;
                if (s) {
                  if (v) startBrowserPipeline(); else startCloudPipeline(s);
                }
                return;
              }
              setUseBrowserTranscription(v);
            }}
          />
          <span className="text-xs text-muted-foreground">If on, use Web Speech API locally and send text only.</span>
        </div>

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
