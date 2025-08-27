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
const WINDOW_MS = 5000;        // 5s window
// STEP_MS removed; use a single recorder with timeslices
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
  const windowTimerRef = useRef(/** @type {ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null} */(null));
  // Single MediaRecorder for continuous rolling windows (timeslices)
  const recognitionRef = useRef(/** @type {any} */(null));
  const isRecordingRef = useRef(false);
  const useBrowserTranscriptionRef = useRef(true);
  const audioCtxRef = useRef(/** @type {AudioContext | null} */(null));
  const processorRef = useRef(/** @type {ScriptProcessorNode | null} */(null));
  const captureBufferRef = useRef(/** @type {Float32Array[]} */([]));
  const inputSampleRateRef = useRef(/** @type {number} */(48000));
  const [nextChunkText, setNextChunkText] = useState("");
  const [chunkStatuses, setChunkStatuses] = useState([]);
  const [readyToSend, setReadyToSend] = useState("");
  const sendTimerRef = useRef(null);
  const isSendingRef = useRef(false);

  // Timing
  const recStartEpochRef = useRef(/** @type {number} */(0));   // performance.now() at start
  const seqRef = useRef(/** @type {number} */(0));


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
  function stopCloudPipeline() {
    try {
      if (windowTimerRef.current) { clearInterval(windowTimerRef.current); windowTimerRef.current = null; }
      if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
      captureBufferRef.current = [];
    } catch { }
  }

  // Simple 10-second send timer
  function startSendTimer() {
    if (sendTimerRef.current) clearInterval(sendTimerRef.current);
    console.log('[TIMER] starting 10s send timer');
    sendTimerRef.current = setInterval(() => {
      console.log('[TIMER] 10s timer fired');
      if (!isRecordingRef.current) return;
      sendReadyText();
    }, 10000);
  }

  function stopSendTimer() {
    if (sendTimerRef.current) {
      clearInterval(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  }

  async function sendReadyText() {
    if (isSendingRef.current) {
      console.log('[SEND] already sending, skipping');
      return;
    }

    // Get current text and clear it immediately
    let textToSend = "";
    setReadyToSend(currentText => {
      textToSend = currentText.trim();
      return ""; // Clear immediately
    });

    if (!textToSend) {
      console.log('[SEND] no text to send');
      return;
    }

    isSendingRef.current = true;
    const seq = seqRef.current++;
    console.log(`[SEND] sending seq=${seq} text="${textToSend}"`);

    setChunkStatuses(prev => [...prev.slice(-19), { seq, status: 'sent', text: textToSend }]);

    const form = new FormData();
    form.append('text', textToSend);
    form.append('seq', String(seq));
    form.append('mode', 'browser');

    try {
      const res = await fetch(ENDPOINT, { method: 'POST', body: form });
      const data = await res.json();
      console.log(`[SEND] response seq=${seq}:`, data);

      if (data.text && data.text.trim()) {
        const transcript = { seq, text: data.text.trim(), timestamp: new Date().toLocaleTimeString() };
        setRecentTranscripts(prev => {
          // Dedupe by text content
          const existing = prev.find(t => t.text === data.text.trim());
          if (existing) {
            console.log(`[SEND] skipping duplicate text for seq=${seq}`);
            return prev;
          }
          return [...prev.slice(-9), transcript];
        });
      }

      setChunkStatuses(prev => prev.map(c => c.seq === seq ? { ...c, status: 'saved' } : c));
    } catch (e) {
      console.error('[SEND] failed:', e);
    } finally {
      isSendingRef.current = false;
    }
  }

  function buildWavBlob(floatChunks, inSampleRate, outSampleRate) {
    try {
      if (!floatChunks || floatChunks.length === 0) return null;
      // merge floats
      let totalLen = 0;
      for (const c of floatChunks) totalLen += c.length;
      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const c of floatChunks) { merged.set(c, offset); offset += c.length; }
      // downsample to outSampleRate mono
      const ratio = inSampleRate / outSampleRate;
      const outLen = Math.floor(merged.length / ratio);
      const pcm16 = new Int16Array(outLen);
      let idx = 0;
      let pos = 0;
      while (idx < outLen) {
        const srcIndex = pos | 0;
        let sample = merged[srcIndex];
        if (sample > 1) sample = 1; else if (sample < -1) sample = -1;
        pcm16[idx++] = (sample * 0x7fff) | 0;
        pos += ratio;
      }
      // WAV header + data
      const bytesPerSample = 2;
      const blockAlign = 1 * bytesPerSample;
      const byteRate = outSampleRate * blockAlign;
      const dataSize = pcm16.length * bytesPerSample;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      let p = 0;
      function writeString(s) { for (let i = 0; i < s.length; i++) view.setUint8(p + i, s.charCodeAt(i)); p += s.length; }
      function writeUint32(v) { view.setUint32(p, v, true); p += 4; }
      function writeUint16(v) { view.setUint16(p, v, true); p += 2; }
      writeString('RIFF');
      writeUint32(36 + dataSize);
      writeString('WAVE');
      writeString('fmt ');
      writeUint32(16);
      writeUint16(1); // PCM
      writeUint16(1); // mono
      writeUint32(outSampleRate);
      writeUint32(byteRate);
      writeUint16(blockAlign);
      writeUint16(16); // bits per sample
      writeString('data');
      writeUint32(dataSize);
      // PCM data
      let dp = p;
      for (let i = 0; i < pcm16.length; i++, dp += 2) view.setInt16(dp, pcm16[i], true);
      return new Blob([view], { type: 'audio/wav' });
    } catch (e) {
      console.warn('[PCM] buildWavBlob failed', e?.message || e);
      return null;
    }
  }

  function stopBrowserPipeline() {
    try { recognitionRef.current?.stop?.(); } catch { }
    recognitionRef.current = null;
    stopSendTimer();
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

    recog.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) {
          const text = res[0]?.transcript?.trim();
          if (text) {
            console.log('[STT] final:', text);
            setReadyToSend(prev => prev ? prev + ' ' + text : text);
            setInterimText("");
            setNextChunkText(""); // Clear preview after final
          }
        } else {
          const partial = res[0]?.transcript?.trim() || "";

          // Merge partial at word level for clean preview
          setNextChunkText(prev => {
            if (!partial) return prev;
            const prevWords = prev.split(' ').filter(Boolean);
            const newWords = partial.split(' ').filter(Boolean);

            // Find longest common prefix to avoid duplicates
            let commonLen = 0;
            while (commonLen < Math.min(prevWords.length, newWords.length) &&
              prevWords[commonLen] === newWords[commonLen]) {
              commonLen++;
            }

            // Take previous words up to common point + all new words from that point
            const merged = [...prevWords.slice(0, commonLen), ...newWords.slice(commonLen)];
            return merged.join(' ');
          });

          // setInterimText(partial); // Not needed, nextChunkText is our preview
        }
      }
    };

    recog.onerror = (e) => {
      console.warn('[STT] error:', e.error);
      // Auto-restart on any error after brief delay
      if (isRecording && useBrowserTranscription) {
        setTimeout(() => {
          if (isRecording && useBrowserTranscription) {
            console.log('[STT] auto-restarting after error');
            try { recog.start(); } catch (err) { console.warn('[STT] auto-restart failed', err); }
          }
        }, 1000);
      }
    };

    recog.onend = () => {
      console.log('[STT] onend');
      if (isRecording && useBrowserTranscription) {
        console.log('[STT] restarting after end');
        try { recog.start(); } catch (e) { console.warn('[STT] restart failed', e); }
      }
    };

    try {
      console.log('[STT] start');
      recog.start();
      startSendTimer();
    } catch (e) { console.warn('[STT] start failed', e); }
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
        if (!cancelled) {
          setDevices(dedup);
          // Temp: auto-select CMTECK device
          const cmteckDevice = dedup.find(d => d.label.toLowerCase().includes('cmteck'));
          if (cmteckDevice) setSelectedDeviceId(cmteckDevice.deviceId);
          console.warn("🚀 ~ DELTE ME /... cmteckDevice:", cmteckDevice)
        }
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

      // reset clocks and active recorder
      try { recRef.current?.stop(); } catch { }
      recRef.current = null;
      seqRef.current = 0;
      recStartEpochRef.current = performance.now();

      // Start appropriate pipeline
      isRecordingRef.current = true;
      useBrowserTranscriptionRef.current = useBrowserTranscription;
      // Only start browser STT in browser mode
      if (useBrowserTranscription) {
        startBrowserPipeline();
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
    isRecordingRef.current = false;
    setStatus("idle");
    // Stop recorders to flush any in-flight windows
    toast.info("Recording stopped");

    // Stop browser STT
    stopBrowserPipeline();

    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { }
    streamRef.current = null;

    // no timers
  }

  useEffect(() => () => stop(), []);

  // keep refs synced with state for background callbacks
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { useBrowserTranscriptionRef.current = useBrowserTranscription; }, [useBrowserTranscription]);

  // Flush current window when the page is hidden or user navigates away
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && isRecording) {
        // Flush PCM buffer
        try { flushRef.current?.(); } catch { }
      }
    }
    function onPageHide() {
      if (isRecording) {
        try { flushRef.current?.(); } catch { }
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
        {/* Next chunk preview */}
        {nextChunkText && (
          <div className="rounded-md border p-2 text-sm">
            <span className="text-muted-foreground">Next chunk:</span> {nextChunkText}
          </div>
        )}

        {/* Text ready to send */}
        {readyToSend && (
          <div className="rounded-md border p-2 text-sm">
            <span className="text-muted-foreground">Ready to send:</span> {readyToSend}
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

        {/* Recent Transcripts Display */}
        {recentTranscripts.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Recent Transcripts</Label>
            <div className="space-y-1 p-3 bg-muted/50 rounded-md">
              {recentTranscripts.slice(-10).reverse().map((transcript) => (
                <div key={transcript.seq} className="text-sm">
                  <span className="text-xs text-muted-foreground">#{transcript.seq} {transcript.timestamp}</span>
                  <div className="pl-2 text-foreground">{transcript.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chunk Statuses */}

      </CardContent>
    </Card>
  );
}
