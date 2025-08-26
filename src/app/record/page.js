"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Mic, Square, Loader2, WifiOff, RefreshCcw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { Slider } from "@/components/ui/slider";

export default function RecordPage() {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <RecordContent />
      </div>
    </AuthGuard>
  );
}

function RecordContent() {
  const { user, currentOrganization, ensureOrganization } = useAuth();

  // Debug auth state (removed to prevent console spam)
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const sseRef = useRef(null);

  // User intent to be recording; we auto-restart recorder/SSE while this is true
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false); // Reliable ref for immediate checks
  const [status, setStatus] = useState("idle"); // idle | recording | reconnecting | error | no-org
  const [isSending, setIsSending] = useState(false);

  const [snippets, setSnippets] = useState([]); // last 20 snippets only
  const [pendingText, setPendingText] = useState(""); // coalesced live text not yet committed

  const sessionIdRef = useRef("");
  const lastActivityRef = useRef(Date.now());
  const heartbeatRef = useRef(null);
  const sseConnectedRef = useRef(false);
  const pendingSnippetRef = useRef("");
  const pendingTimerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const vadDataRef = useRef(null);
  const vadIntervalRef = useRef(null);
  const vadThresholdRef = useRef(0.02);
  const maxRmsSinceLastChunkRef = useRef(0);
  const inflightRef = useRef(0);
  const chunkTimerRef = useRef(null);
  const chunkLengthMsRef = useRef(4000); // Shorter chunks for more overlap
  const overlapMsRef = useRef(1000); // 1 second overlap
  const isStartingRef = useRef(false);
  const retryCountRef = useRef(0);
  const maxRetriesRef = useRef(5);
  const retryDelayRef = useRef(1000);
  const lastSuccessfulChunkRef = useRef(Date.now());
  const healthCheckRef = useRef(null);
  const recoveryInProgressRef = useRef(false);

  // Helper to update both recording state and ref synchronously
  function updateRecording(value) {
    recordingRef.current = value;
    setRecording(value);
    console.debug("[record] updateRecording", { value });
  }

  async function forceRecovery(reason = "unknown") {
    if (recoveryInProgressRef.current) return;
    recoveryInProgressRef.current = true;
    console.warn("[record] FORCE RECOVERY", { reason, retryCount: retryCountRef.current });

    try {
      // Clean up everything
      try { mediaRecorderRef.current?.stop(); } catch { }
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { }
      try { if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; } } catch { }
      try { audioCtxRef.current?.close(); } catch { }
      try { if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; } } catch { }

      // Wait before retry
      const delay = Math.min(retryDelayRef.current * Math.pow(2, retryCountRef.current), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));

      if (!recordingRef.current) {
        recoveryInProgressRef.current = false;
        return;
      }

      // Restart everything
      setStatus("reconnecting");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      vadThresholdRef.current = rmsThreshold;

      // Restart VAD
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        analyserRef.current = analyser;
        vadDataRef.current = new Uint8Array(analyser.fftSize);
        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = setInterval(() => {
          try {
            analyser.getByteTimeDomainData(vadDataRef.current);
            let sumSquares = 0;
            for (let i = 0; i < vadDataRef.current.length; i++) {
              const centered = (vadDataRef.current[i] - 128) / 128;
              sumSquares += centered * centered;
            }
            const rms = Math.sqrt(sumSquares / vadDataRef.current.length);
            setCurrentRms(rms);
            if (rms > (maxRmsSinceLastChunkRef.current || 0)) {
              maxRmsSinceLastChunkRef.current = rms;
            }
          } catch (e) {
            console.warn("[record] VAD error", e?.message);
          }
        }, 150);
      } catch (e) {
        console.warn("[record] VAD setup failed", e?.message);
      }

      // Start recording again
      setupMediaRecorder(stream);
      console.debug("[record] recovery: start recorder");
      try { mediaRecorderRef.current?.start(); } catch (e) { throw new Error(`Failed to start recorder: ${e?.message}`); }

      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = setTimeout(() => {
        console.debug("[record] recovery timer: stopping recorder");
        try { if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop(); } catch { }
        chunkTimerRef.current = null;
      }, chunkLengthMsRef.current);

      setStatus("recording");
      lastActivityRef.current = Date.now();
      lastSuccessfulChunkRef.current = Date.now();
      retryCountRef.current = 0; // Reset on success
      console.log("[record] recovery successful");

    } catch (e) {
      console.error("[record] recovery failed", e?.message);
      retryCountRef.current += 1;
      if (retryCountRef.current < maxRetriesRef.current) {
        console.warn("[record] will retry recovery", { retryCount: retryCountRef.current });
        setTimeout(() => forceRecovery(`retry-${retryCountRef.current}`), 2000);
      } else {
        console.error("[record] max retries reached, stopping");
        setStatus("error");
        updateRecording(false);
      }
    } finally {
      recoveryInProgressRef.current = false;
    }
  }

  function scheduleNextChunk() {
    if (!recordingRef.current) {
      console.debug("[record] scheduleNextChunk: not recording, skipping", { recording, recordingRef: recordingRef.current });
      return;
    }
    if (isStartingRef.current) {
      console.debug("[record] scheduleNextChunk: already starting, skipping");
      return;
    }
    if (recoveryInProgressRef.current) {
      console.debug("[record] scheduleNextChunk: recovery in progress, skipping");
      return;
    }

    console.debug("[record] scheduleNextChunk: starting new chunk");
    isStartingRef.current = true;
    try {
      const live = streamRef.current && streamRef.current.getTracks().some((t) => t.readyState === 'live');
      if (!live) {
        console.warn("[record] stream not live, triggering recovery");
        isStartingRef.current = false;
        forceRecovery("stream-not-live");
        return;
      }

      setTimeout(() => {
        try {
          if (!recordingRef.current) {
            console.debug("[record] scheduleNextChunk timeout: not recording anymore");
            isStartingRef.current = false;
            return;
          }

          setupMediaRecorder(streamRef.current);
          console.debug("[record] next chunk: start recorder");

          try {
            if (mediaRecorderRef.current?.state === 'inactive') {
              mediaRecorderRef.current.start();
            } else {
              throw new Error(`Recorder in invalid state: ${mediaRecorderRef.current?.state}`);
            }
          } catch (e) {
            console.error("[record] failed to start recorder", e?.message);
            isStartingRef.current = false;
            forceRecovery("recorder-start-failed");
            return;
          }

          if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
          chunkTimerRef.current = setTimeout(() => {
            console.debug("[record] chunk timer: stopping recorder");
            try {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                mediaRecorderRef.current.stop();
              }
            } catch (e) {
              console.warn("[record] error stopping recorder", e?.message);
            }
            chunkTimerRef.current = null;
          }, chunkLengthMsRef.current);

          // Schedule next chunk with overlap (start before current chunk ends)
          setTimeout(() => {
            if (recordingRef.current && !isStartingRef.current && !recoveryInProgressRef.current) {
              console.debug("[record] scheduling overlapping chunk");
              scheduleNextChunk();
            }
          }, chunkLengthMsRef.current - overlapMsRef.current);

        } catch (e) {
          console.error("[record] scheduleNextChunk error", e?.message);
          forceRecovery("schedule-error");
        } finally {
          isStartingRef.current = false;
        }
      }, 30);
    } catch (e) {
      console.error("[record] scheduleNextChunk outer error", e?.message);
      isStartingRef.current = false;
      forceRecovery("schedule-outer-error");
    }
  }

  const [rmsThreshold, setRmsThreshold] = useState(0.015);
  const [currentRms, setCurrentRms] = useState(0);

  // Note: AuthGuard already prevents unauthenticated access

  useEffect(() => {
    return () => {
      console.log("[record] component cleanup");
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch { }
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
      } catch { }
      try { sseRef.current?.close?.(); } catch { }

      // Clean up all timers and intervals
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (healthCheckRef.current) {
        clearInterval(healthCheckRef.current);
        healthCheckRef.current = null;
      }
      try { if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; } } catch { }
      try { if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; } } catch { }
      try { if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; } } catch { }

      try { audioCtxRef.current?.close?.(); } catch { }
    };
  }, []);

  function commitPendingSnippet() {
    const text = (pendingSnippetRef.current || "").trim();
    if (text) {
      setSnippets((prev) => [...prev, text].slice(-20));
      console.debug("[record] commit snippet", { text });
    }
    pendingSnippetRef.current = "";
    setPendingText("");
  }

  function coalesceSnippet(nextText) {
    if (!nextText) return;
    const incoming = String(nextText).trim();
    if (!incoming) return;

    // merge with pending for smoother word boundaries
    const current = pendingSnippetRef.current || "";
    let merged = current;
    if (!current) {
      merged = incoming;
    } else {
      const lastChar = current.slice(-1);
      const firstChar = incoming.charAt(0);
      if (lastChar === "-") {
        // hyphenated split, drop hyphen and join without space
        merged = current.slice(0, -1) + incoming;
      } else {
        const lastWord = current.split(/\s+/).pop();
        const firstWord = incoming.split(/\s+/)[0];
        if (lastWord && firstWord && lastWord.toLowerCase() === firstWord.toLowerCase()) {
          merged = current + " " + incoming.split(/\s+/).slice(1).join(" ");
        } else {
          merged = current + (lastChar ? " " : "") + incoming;
        }
      }
    }
    pendingSnippetRef.current = merged;
    setPendingText(merged);

    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => {
      commitPendingSnippet();
    }, 700);
  }

  function handleIncomingText(text) {
    lastActivityRef.current = Date.now();
    coalesceSnippet(text);
  }

  async function ensureSession() {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const res = await fetch(`/api/transcribe?action=start`, { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        sessionIdRef.current = json.sessionId || "";
        openSSE(sessionIdRef.current);
      }
    } catch { }
    return sessionIdRef.current;
  }

  function openSSE(id) {
    if (!id) return;
    try { sseRef.current?.close?.(); } catch { }
    const es = new EventSource(`/api/transcribe?sessionId=${encodeURIComponent(id)}`);
    sseRef.current = es;
    es.onopen = () => {
      sseConnectedRef.current = true;
      if (recordingRef.current) setStatus("recording");
      console.debug("[record] SSE opened", { sessionId: id });
    };
    es.onmessage = (evt) => {
      lastActivityRef.current = Date.now();
      try {
        const data = JSON.parse(evt.data || '{}');
        console.debug("[record] SSE message", { type: data?.type, chars: data?.text?.length || 0 });
        if (data?.type === 'update' && data.text) {
          handleIncomingText(data.text);
        }
        if (data?.type === 'end') {
          try { es.close(); } catch { }
          console.debug("[record] SSE end received");
        }
      } catch { }
    };
    es.onerror = () => {
      sseConnectedRef.current = false;
      console.warn("[record] SSE error; will retry if recording");
      if (recordingRef.current) {
        setStatus("reconnecting");
        // quick retry to keep live
        setTimeout(() => {
          if (sessionIdRef.current && recordingRef.current) openSSE(sessionIdRef.current);
        }, 1000);
      } else {
        try { es.close(); } catch { }
      }
    };
  }

  function setupMediaRecorder(stream) {
    let mr;
    try {
      mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    } catch {
      mr = new MediaRecorder(stream);
    }
    mediaRecorderRef.current = mr;

    mr.addEventListener("dataavailable", async (e) => {
      if (!e.data || e.data.size === 0) {
        console.warn("[record] empty data in dataavailable");
        // Still schedule next chunk even if data is empty
        scheduleNextChunk();
        return;
      }

      lastActivityRef.current = Date.now();
      lastSuccessfulChunkRef.current = Date.now();

      try {
        const peakRms = maxRmsSinceLastChunkRef.current || 0;
        maxRmsSinceLastChunkRef.current = 0;

        // With overlapping chunks, next chunk is already scheduled - no need to schedule here

        if (peakRms < (vadThresholdRef.current || 0)) {
          console.debug("[record] skip silent chunk", { peakRms, threshold: vadThresholdRef.current });
          return;
        }

        inflightRef.current += 1;
        setIsSending(true);

        const chunkData = {
          blob: e.data,
          size: e.data.size,
          timestamp: Date.now(),
          peakRms
        };

        // Retry logic for chunk upload
        const uploadChunk = async (retries = 3) => {
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              const form = new FormData();
              form.append("chunk", chunkData.blob, `chunk-${chunkData.timestamp}.webm`);
              const qs = ``;

              console.debug("[record] uploading chunk", {
                size: chunkData.size,
                peakRms: chunkData.peakRms,
                attempt: attempt + 1
              });

              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

              const res = await fetch(`/api/transcribe${qs}`, {
                method: "POST",
                body: form,
                signal: controller.signal
              });

              clearTimeout(timeoutId);

              console.debug("[record] chunk response", { ok: res.ok, status: res.status, attempt: attempt + 1 });

              if (!res.ok) {
                if (res.status >= 500 && attempt < retries - 1) {
                  // Server error, retry
                  const delay = 1000 * Math.pow(2, attempt);
                  console.warn("[record] server error, retrying", { status: res.status, delay });
                  await new Promise(resolve => setTimeout(resolve, delay));
                  continue;
                }
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
              }

              const json = await res.json();
              console.debug("[record] chunk json", { hasText: Boolean(json?.text), keys: Object.keys(json || {}) });

              if (json?.text) {
                handleIncomingText(json.text);
              }

              return json; // Success

            } catch (err) {
              console.error("[record] chunk upload error", {
                attempt: attempt + 1,
                error: err?.message,
                name: err?.name
              });

              if (attempt === retries - 1) {
                // Final attempt failed
                throw err;
              }

              if (err?.name === 'AbortError') {
                console.warn("[record] chunk upload timeout, retrying");
              }

              // Wait before retry
              const delay = 1000 * Math.pow(2, attempt);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        };

        // Upload with retries
        uploadChunk()
          .then(() => {
            // Success - reset any retry counters
            retryCountRef.current = 0;
          })
          .catch((err) => {
            console.error("[record] chunk upload failed after all retries", err?.message);
            // Don't trigger full recovery for upload failures, just log
            // The recording continues and we'll try the next chunk
          })
          .finally(() => {
            inflightRef.current = Math.max(0, inflightRef.current - 1);
            if (inflightRef.current === 0) setIsSending(false);
          });

      } catch (err) {
        console.error("[record] dataavailable error", err?.message);
        inflightRef.current = Math.max(0, inflightRef.current - 1);
        if (inflightRef.current === 0) setIsSending(false);

        // If this is a critical error, trigger recovery
        if (err?.message?.includes('recorder') || err?.message?.includes('stream')) {
          forceRecovery("dataavailable-error");
        }
      }
    });

    mr.addEventListener("stop", () => {
      console.debug("[record] recorder stopped");
      // Note: scheduleNextChunk() is called in dataavailable event, not here
    });

    return mr;
  }

  async function startRecording() {
    if (recordingRef.current) return;

    // Ensure user has an organization before starting
    try {
      await ensureOrganization();
    } catch (e) {
      console.error("[record] ❌ Failed to ensure organization:", e?.message);
      setStatus("no-org");
      return;
    }

    updateRecording(true);
    setStatus("reconnecting");

    // Initialize timing for health checks
    lastSuccessfulChunkRef.current = Date.now();

    // Using daily sessions - no need for client session ID
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { }
      streamRef.current = stream;
      vadThresholdRef.current = rmsThreshold;
      // Lightweight VAD using WebAudio RMS
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        analyserRef.current = analyser;
        vadDataRef.current = new Uint8Array(analyser.fftSize);
        if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = setInterval(() => {
          try {
            analyser.getByteTimeDomainData(vadDataRef.current);
            let sumSquares = 0;
            for (let i = 0; i < vadDataRef.current.length; i++) {
              const centered = (vadDataRef.current[i] - 128) / 128;
              sumSquares += centered * centered;
            }
            const rms = Math.sqrt(sumSquares / vadDataRef.current.length);
            setCurrentRms(rms);
            if (rms > (maxRmsSinceLastChunkRef.current || 0)) {
              maxRmsSinceLastChunkRef.current = rms;
            }
          } catch { }
        }, 150);
      } catch { }
      setupMediaRecorder(stream);
      console.debug("[record] first chunk: start recorder");
      try { mediaRecorderRef.current?.start(); } catch { }
      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = setTimeout(() => {
        console.debug("[record] first chunk timer: stopping recorder");
        try { if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop(); } catch { }
        chunkTimerRef.current = null;
      }, chunkLengthMsRef.current);
      setStatus("recording");
      lastActivityRef.current = Date.now();
      console.debug("[record] recording started");
    } catch {
      setStatus("error");
      updateRecording(false);
      return;
    }

    // Enhanced health monitoring and recovery
    if (!healthCheckRef.current) {
      healthCheckRef.current = setInterval(() => {
        if (!recordingRef.current) return;

        const now = Date.now();
        const mr = mediaRecorderRef.current;
        const stream = streamRef.current;

        // Check 1: Recorder state - only worry if it's been inactive for too long
        // Allow brief inactive periods during normal chunk transitions
        if (!mr) {
          console.warn("[record] health check: no recorder");
          forceRecovery("health-check-no-recorder");
          return;
        }

        // If recorder is inactive, check if we're in a normal transition or stuck
        if (mr.state !== "recording") {
          const timeSinceLastChunk = now - lastSuccessfulChunkRef.current;
          // Only trigger recovery if recorder has been inactive for more than 10 seconds
          // This allows normal chunk transitions which take ~30ms + processing time
          if (timeSinceLastChunk > 10000) {
            console.warn("[record] health check: recorder stuck inactive", {
              state: mr.state,
              timeSinceLastChunk,
              isStarting: isStartingRef.current,
              recoveryInProgress: recoveryInProgressRef.current
            });
            forceRecovery("health-check-recorder-stuck");
            return;
          } else {
            console.debug("[record] health check: recorder temporarily inactive (normal)", {
              state: mr.state,
              timeSinceLastChunk
            });
          }
        }

        // Check 2: Stream health
        if (!stream || !stream.getTracks().some(t => t.readyState === 'live')) {
          console.warn("[record] health check: stream not live", {
            hasStream: !!stream,
            trackStates: stream?.getTracks().map(t => t.readyState) || []
          });
          forceRecovery("health-check-stream");
          return;
        }

        // Check 3: Chunk timeout (no successful chunks in too long)
        const timeSinceLastChunk = now - lastSuccessfulChunkRef.current;
        // Be more lenient for the first chunk (20s) vs subsequent chunks (15s)
        const timeoutThreshold = (lastSuccessfulChunkRef.current === 0) ? 20000 : 15000;
        if (timeSinceLastChunk > timeoutThreshold) {
          console.warn("[record] health check: no chunks for too long", {
            timeSinceLastChunk,
            timeoutThreshold,
            lastSuccessfulChunk: lastSuccessfulChunkRef.current
          });
          forceRecovery("health-check-timeout");
          return;
        }

        // Check 4: Timer validation
        if (!chunkTimerRef.current && !isStartingRef.current && !recoveryInProgressRef.current) {
          console.warn("[record] health check: no chunk timer active");
          scheduleNextChunk();
        }

        // Check 5: VAD analysis
        if (!vadIntervalRef.current) {
          console.warn("[record] health check: VAD not running");
          // Don't force recovery for VAD, just log
        }

        console.debug("[record] health check passed", {
          recorderState: mr?.state,
          streamTracks: stream?.getTracks().length,
          timeSinceLastChunk,
          hasChunkTimer: !!chunkTimerRef.current,
          hasVAD: !!vadIntervalRef.current,
          inflightChunks: inflightRef.current
        });

      }, 6000); // Check every 6 seconds (offset from 4s chunk cycle)
    }

    // Lightweight heartbeat for basic monitoring
    if (!heartbeatRef.current) {
      heartbeatRef.current = setInterval(() => {
        if (!recordingRef.current) return;

        // Just update activity timestamp and basic logging
        const now = Date.now();
        console.debug("[record] heartbeat", {
          recording,
          status,
          inflightChunks: inflightRef.current,
          timeSinceActivity: now - lastActivityRef.current
        });

      }, 10000); // Every 10 seconds
    }
  }

  function stopRecording() {
    if (!recordingRef.current) return;
    updateRecording(false);
    setStatus("idle");
    commitPendingSnippet();

    console.log("[record] stopping recording and cleaning up");

    // Stop all recording components
    try { mediaRecorderRef.current?.stop(); } catch { }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { }
    try { if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; } } catch { }
    try { audioCtxRef.current?.close?.(); } catch { }
    try { if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; } } catch { }

    // Stop monitoring systems
    if (healthCheckRef.current) {
      clearInterval(healthCheckRef.current);
      healthCheckRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    // Reset state
    recoveryInProgressRef.current = false;
    isStartingRef.current = false;
    retryCountRef.current = 0;

    // Daily sessions are automatically finalized - no need for explicit finalize
    console.log("[record] recording session complete");

    try { sseRef.current?.close?.(); } catch { }
  }

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {status === "recording" ? (
                <span className="flex items-center gap-2 text-green-600"><span className="inline-block h-2 w-2 rounded-full bg-green-500" />Recording</span>
              ) : status === "reconnecting" ? (
                <span className="flex items-center gap-2 text-amber-600"><Loader2 className="h-4 w-4 animate-spin" />Reconnecting…</span>
              ) : status === "error" ? (
                <span className="flex items-center gap-2 text-red-600"><WifiOff className="h-4 w-4" />Error</span>
              ) : status === "no-org" ? (
                <span className="flex items-center gap-2 text-red-600"><WifiOff className="h-4 w-4" />No Organization</span>
              ) : (
                <span className="text-muted-foreground">Idle</span>
              )}
              {recoveryInProgressRef.current && (
                <span className="flex items-center gap-1 text-amber-600"><RefreshCcw className="h-3 w-3 animate-spin" />Recovery</span>
              )}
              {isSending && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Sending</span>}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {!recording ? (
                <Button onClick={startRecording} size="icon" className="h-16 w-16 rounded-full sm:h-20 sm:w-20">
                  <Mic className="h-7 w-7 sm:h-8 sm:w-8" />
                </Button>
              ) : (
                <Button onClick={stopRecording} size="icon" variant="destructive" className="h-16 w-16 rounded-full sm:h-20 sm:w-20">
                  <Square className="h-7 w-7 sm:h-8 sm:w-8" />
                </Button>
              )}
              {(status === "error" || status === "no-org") && (
                <Button variant="secondary" size="icon" onClick={() => { if (!recordingRef.current) startRecording(); }} aria-label="Retry">
                  <RefreshCcw className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Input level</span>
              <span className="tabular-nums text-muted-foreground">{currentRms.toFixed(3)}</span>
            </div>
            <Progress value={Math.min(100, Math.round((currentRms / 0.05) * 100))} />
            <div className="space-y-1">
              <Label htmlFor="vad-threshold" className="text-sm text-muted-foreground">Sensitivity</Label>
              <div className="flex items-center gap-3">
                <Slider
                  id="vad-threshold"
                  min={0.005}
                  max={0.05}
                  step={0.001}
                  value={[rmsThreshold]}
                  onValueChange={(val) => {
                    const v = Array.isArray(val) ? Number(val[0]) : Number(val);
                    setRmsThreshold(v);
                    vadThresholdRef.current = v;
                  }}
                  className="flex-1"
                />
                <div className="w-20 text-right text-sm tabular-nums">{rmsThreshold.toFixed(3)}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">Chunks below the threshold are skipped to avoid sending silence.</div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Recent snippets</div>
            <div className="rounded-md border p-3 max-h-64 overflow-auto">
              {snippets.length === 0 ? (
                <div className="text-sm text-muted-foreground">No snippets yet. Start talking to see live updates…</div>
              ) : (
                <ul className="space-y-2">
                  {snippets.slice(-20).map((s, i) => (
                    <li key={i} className="text-sm leading-relaxed">{s}</li>
                  ))}
                  {pendingText ? (
                    <li className="text-sm leading-relaxed text-muted-foreground">{pendingText}</li>
                  ) : null}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


