import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View, ActivityIndicator, TextInput, Animated, Easing, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
// import { ThemedView } from '@/components/ThemedView'; // DISABLED FOR TESTING
import { ThemedText } from '@/components/ThemedText';
// import ParallaxScrollView from '@/components/ParallaxScrollView'; // DISABLED FOR TESTING
import { getSupabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import {
  useAudioRecorder,
  AudioModule,
  setAudioModeAsync,
  useAudioRecorderState,
  IOSOutputFormat,
  AudioQuality,
} from 'expo-audio';
// Removed local STT; keeping simple manual start/stop with server-side session handling

// Simple text-only "record" MVP to align with stateless 5s chunks approach
export default function RecordScreen() {
  const hasAudio = !!(AudioModule as any)?.requestRecordingPermissionsAsync;
  // Simple gate to avoid crashing in Expo Go where expo-audio native module isn't available
  if (!hasAudio) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <View className="gap-3">
          <ThemedText type="title">Recorder</ThemedText>
          <ThemedText className="text-gray-500 dark:text-gray-400">
            Audio module unavailable. Build a dev client to enable recording.
          </ThemedText>
          <ThemedText>
            Run: npx expo run:ios (or EAS build) and open the built app instead of Expo Go.
          </ThemedText>
        </View>
      </ScrollView>
    );
  }
  return <RecordScreenInner />
}

function RecordScreenInner() {
  // Minimal session-based recorder with live caption snippets from server
  // TEMPORARILY DISABLED useSafeAreaInsets to fix navigation context issue
  // const insets = useSafeAreaInsets();
  const insets = { top: 44, bottom: 20, left: 0, right: 0 }; // Fixed safe area values
  const [recentTranscripts, setRecentTranscripts] = useState<{ seq: number; text: string; timestamp: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [hasStoppedRecording, setHasStoppedRecording] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Computed state - effectively recording if recording but not stopped
  const effectivelyRecording = isRecording && !hasStoppedRecording;
  const [isAuthed, setIsAuthed] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const seqRef = useRef<number>(0);
  const cloudChunkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNativeRecorderActiveRef = useRef<boolean>(false);
  const nextSendAtRef = useRef<number>(0);
  const uiTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // countdown removed from UI (state removed)
  // const [sendCountdownMs, setSendCountdownMs] = useState(0);
  const CHUNK_INTERVAL_MS = 5000; // 5s to match web/stateless approach
  const chunkDirRef = useRef<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  // finalize progress not shown to user; retain states if needed later
  // Finalize progress hidden in UI; no explicit progress tracking
  const [summaryText, setSummaryText] = useState<string>('');
  const [actionItems, setActionItems] = useState<string[]>([]);
  const finalizePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // lastSessionId kept in ref only
  const lastSessionIdRef = useRef<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState<boolean>(false);
  const orgIdRef = useRef<string | null>(null);
  // Recording duration timer
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);

  // Format duration helper
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Comprehensive state reset for clean new sessions
  const resetForNewSession = useCallback(() => {
    console.log('[rec] resetting all state for new session');
    // Core recording states - ensure clean slate (but don't clear isStarting if we're starting)
    setIsRecording(false);
    setHasStoppedRecording(false);
    // Don't clear isStarting here - it's managed by the button press flow
    setIsStopping(false);

    // UI States
    setJustSaved(false);
    setIsFinalizing(false);
    setRecordingDuration(0);
    setRecentTranscripts([]);

    // Clear form fields for fresh session
    setTitle('');
    setCustomPrompt('');

    // Refs - don't reset sessionIdRef here as it's needed for auto-finalize
    seqRef.current = 0;
    try { seenMd5Ref.current.clear(); } catch { }
    try { uploadQueueRef.current.length = 0; } catch { }
    recordingStartTimeRef.current = null;

    // Clear any remaining timers
    if (durationTimerRef.current) {
      try { clearInterval(durationTimerRef.current as any); } catch { }
      durationTimerRef.current = null;
    }
  }, []);

  // Pulse animation for record button
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<any>(null);
  // Internal counters removed from UI; keep only refs if needed later
  // const [sentCount, setSentCount] = useState<number>(0);
  // const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // const [nowTick, setNowTick] = useState<number>(0);

  const ensureChunkDirAsync = useCallback(async () => {
    try {
      if (!chunkDirRef.current) {
        const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
        const dir = base + 'chunks/';
        chunkDirRef.current = dir;
      }
      const dir = chunkDirRef.current!;
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
      return dir;
    } catch {
      return FileSystem.cacheDirectory || '';
    }
  }, []);

  // refs for state mirrors
  const isRecordingRef = useRef(false);
  const isSendingRef = useRef(false);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isSendingRef.current = isSending; }, [isSending]);

  // Drive a subtle pulse while recording
  useEffect(() => {
    if (isRecording) {
      try { pulseLoopRef.current?.stop?.(); } catch { }
      pulseAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current = loop;
      loop.start();
    } else {
      try { pulseLoopRef.current?.stop?.(); } catch { }
      pulseLoopRef.current = null;
    }
    return () => {
      try { pulseLoopRef.current?.stop?.(); } catch { }
      pulseLoopRef.current = null;
    };
  }, [isRecording, pulseAnim]);

  const pulseScale = useMemo(() => pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }), [pulseAnim]);
  const pulseOpacity = useMemo(() => pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.35] }), [pulseAnim]);

  const recordingOptions = useMemo(() => ({
    extension: '.m4a',
    sampleRate: 16000,
    numberOfChannels: 1,
    ios: {
      outputFormat: IOSOutputFormat.MPEG4AAC,
      audioQuality: AudioQuality.MEDIUM,
    },
  } as any), []);

  const audioRecorder = useAudioRecorder(recordingOptions, (status) => {
    console.log('[rec] status', status);
  });
  const recorderState = useAudioRecorderState(audioRecorder);
  const audioRecorderRef = useRef<any>(null);
  useEffect(() => { audioRecorderRef.current = audioRecorder; }, [audioRecorder]);
  const stopInProgressRef = useRef<boolean>(false);

  const apiBaseUrl = useMemo(() => (globalThis as any).__COPILOT_API_BASE_URL__ || 'http://localhost:3000', []);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        setIsAuthed(!!data?.session);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  // Load nearby calendar events for quick title fill
  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: sess } = await supabase.auth.getSession();
        if (!sess?.session) return;
        const { data: orgs, error: orgErr } = await supabase.rpc('my_organizations');
        const orgId = (!orgErr && Array.isArray(orgs) && orgs.length > 0) ? String(orgs[0].org_id) : null;
        orgIdRef.current = orgId;
        if (!orgId) return;
        setEventsLoading(true);
        const now = Date.now();
        const min = new Date(now - 15 * 60 * 1000).toISOString();
        const max = new Date(now + 2 * 60 * 60 * 1000).toISOString();
        const { data: evs, error } = await supabase
          .from('calendar_events')
          .select('id,title,starts_at,ends_at')
          .eq('organization_id', orgId)
          .gte('starts_at', min)
          .lte('starts_at', max)
          .order('starts_at', { ascending: true })
          .limit(5);
        if (!error && Array.isArray(evs)) setEvents(evs);
      } catch { }
      finally {
        setEventsLoading(false);
      }
    })();
  }, []);

  // Stop recording immediately without attempting to flush pending buffers
  const stopRecordingImmediately = useCallback(async () => {
    try {
      if (cloudChunkTimeoutRef.current) {
        try { clearTimeout(cloudChunkTimeoutRef.current as any); } catch { }
        cloudChunkTimeoutRef.current = null;
      }
      // Use our new state management approach
      setHasStoppedRecording(true);
      setIsRecording(false);
      try { await audioRecorder.stop(); } catch { }
      isNativeRecorderActiveRef.current = false;

      // Clear duration timer
      if (durationTimerRef.current) {
        try { clearInterval(durationTimerRef.current as any); } catch { }
        durationTimerRef.current = null;
      }
      recordingStartTimeRef.current = null;

      // Reset to clean state after a delay
      setTimeout(() => {
        resetForNewSession();
      }, 1000);
    } catch { }
  }, [audioRecorder, resetForNewSession]);

  // No local STT in MVP

  type QueuedUpload = { uri: string; seq: number };

  const sendChunk = useCallback(async (item: QueuedUpload) => {
    try {
      setIsSending(true);
      const { uri, seq } = item;
      console.log('[session] sending chunk', { uri, seq });
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) throw new Error('No active session');
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const form = new FormData();
      const filename = 'chunk.m4a';
      const type = 'audio/mp4';
      try {
        const info = await FileSystem.getInfoAsync(uri);
        console.log('[rec] file info', info);
      } catch { }
      // @ts-ignore RN FormData file
      form.append('chunk', { uri, name: filename, type });
      form.append('mimeType', type);
      form.append('seq', String(seq));
      console.log('[rec] POST', `${apiBaseUrl}/api/sessions/${currentSessionId}/chunk`, { filename, type, seq });
      const res = await fetch(`${apiBaseUrl}/api/sessions/${currentSessionId}/chunk`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: form as any,
      });
      const data = await res.json().catch(() => ({}));
      console.log('[session] chunk response', res.status, data);
      if (res.status === 401 || data?.message === 'Unauthorized') {
        await stopRecordingImmediately();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error(data?.message || `Failed: ${res.status}`);
      }
      const live = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : '';
      if (live) {
        setRecentTranscripts(prev => [
          { seq: Date.now(), text: live, timestamp: new Date().toLocaleTimeString() },
          ...prev.slice(0, 9)
        ]);
      }
      // seq was assigned at enqueue time to ensure monotonic order
      // diagnostics removed from UI
      // chunk saved successfully - no UI notification needed
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      console.log('[session] upload failed', e?.message);
      if (msg.includes('no active session')) {
        // Stop recording immediately if session is missing
        try { await stopRecordingImmediately(); } catch { }
      }
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setTimeout(() => {
        setIsSending(false);
      }, 250)
    }
  }, [apiBaseUrl, stopRecordingImmediately]);

  // Serialize uploads to guarantee unique seq per part and avoid duplicates
  const uploadQueueRef = useRef<QueuedUpload[]>([]);
  const isUploadingRef = useRef<boolean>(false);
  const seenMd5Ref = useRef<Set<string>>(new Set());

  const processUploadQueue = useCallback(async () => {
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;
    try {
      while (uploadQueueRef.current.length > 0) {
        const nextItem = uploadQueueRef.current.shift() as QueuedUpload;
        // Basic retry loop
        let attempt = 0;
        // Mark UI sending
        setIsSending(true);
        for (; attempt < 3; attempt++) {
          try {
            await sendChunk(nextItem);
            break;
          } catch {
            await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
          }
        }
        setTimeout(() => {
          setIsSending(false);
        }, 100)
      }
    } finally {
      isUploadingRef.current = false;
    }
  }, [sendChunk]);

  const enqueueUpload = useCallback(async (uri: string | null) => {
    if (!uri) return;
    // Compute md5 to avoid duplicates
    try {
      const info = await FileSystem.getInfoAsync(uri, { md5: true } as any);
      const md5 = String((info as any)?.md5 || '');
      if (md5 && seenMd5Ref.current.has(md5)) {
        console.log('[queue] skip duplicate by md5', md5);
        return;
      }
      if (md5) seenMd5Ref.current.add(md5);
    } catch { }
    // Assign a unique seq for this file at enqueue time
    const seqForThis = seqRef.current;
    seqRef.current = seqRef.current + 1;
    uploadQueueRef.current.push({ uri, seq: seqForThis });
    // Kick processor
    processUploadQueue().catch(() => { });
  }, [processUploadQueue]);

  // No text sending in MVP

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    // isStarting is now set by the button press for immediate feedback

    // Reset any leftover state from previous session
    resetForNewSession();

    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        return Alert.alert('Microphone denied');
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      // Create session first (include optional title/prompt)
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const payload: any = {};
      if (title && title.trim()) payload.title = title.trim();
      if (customPrompt && customPrompt.trim()) payload.summary_prompt = customPrompt.trim();
      const createRes = await fetch(`${apiBaseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const created = await createRes.json().catch(() => ({}));
      if (createRes.status === 401 || created?.message === 'Unauthorized') {
        throw new Error('Unauthorized');
      }
      if (!createRes.ok || !created?.session_id) {
        throw new Error(created?.message || 'Failed to create session');
      }
      sessionIdRef.current = created.session_id;
      seqRef.current = 0;
      try { seenMd5Ref.current.clear(); } catch { }

      // Drive explicit 10s chunks using a simple stop→send→restart loop
      const getRecordingUri = (): string | null => {
        const rAny: any = audioRecorderRef.current as any;
        const direct = (audioRecorderRef.current as any)?.uri || rAny?.url || (recorderState as any)?.url;
        return typeof direct === 'string' && direct.length > 0 ? direct : null;
      };

      const startChunk = async () => {
        try {
          if (stopInProgressRef.current) {
            console.log('[rec] startChunk skipped - stop in progress');
            return;
          }
          if (!isRecordingRef.current) {
            console.log('[rec] startChunk skipped - not recording');
            return;
          }
          console.log('[rec] prepareToRecordAsync with fresh options…');
          // Create a unique file path for each chunk to avoid reusing the same file
          const chunkOptions = {
            ...recordingOptions,
            // Create a unique filename for each recording
            fileUri: `${await ensureChunkDirAsync()}recording-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.m4a`
          };
          console.log('[rec] preparing with unique path:', chunkOptions.fileUri);
          await audioRecorderRef.current?.prepareToRecordAsync(chunkOptions);
          console.log('[rec] record()');
          audioRecorderRef.current?.record();
          isNativeRecorderActiveRef.current = true;
          console.log('[rec] startChunk completed successfully');
        } catch (e: any) {
          console.log('[rec] startChunk error', e?.message);
          // If startChunk fails, we should stop the recording loop
          if (isRecordingRef.current) {
            console.log('[rec] stopping recording due to startChunk failure');
            setIsRecording(false);
          }
        }
      };

      const stopAndSendChunk = async () => {
        try {
          if (stopInProgressRef.current) {
            console.log('[rec] stopAndSendChunk skipped - already in progress');
            return;
          }
          stopInProgressRef.current = true;
          console.log('[rec] stopAndSendChunk - isNativeRecorderActive:', isNativeRecorderActiveRef.current);

          let uri: string | null = null;
          if (isNativeRecorderActiveRef.current) {
            console.log('[rec] stop()…');
            // --- FIXED: Capture the URI directly from the return value of stop() ---
            const uriFromStop = await audioRecorderRef.current?.stop();
            isNativeRecorderActiveRef.current = false;
            // Use the reliable URI first, with a fallback to the old method just in case
            uri = uriFromStop || getRecordingUri();
            console.log('[rec] stopped with uri:', uri);
          } else {
            console.log('[rec] no active recording to stop, starting fresh');
          }

          // Reset the flag BEFORE starting the new chunk to avoid race condition
          stopInProgressRef.current = false;
          console.log('[rec] reset stopInProgressRef, about to startChunk');

          // Immediately restart recording to avoid gaps
          await startChunk();

          // Copy and send old chunk in background (if we have one)
          if (uri) {
            // Process the old chunk in the background without blocking
            (async () => {
              try {
                const info = await FileSystem.getInfoAsync(uri);
                if (info.exists && info.size && info.size > 0) {
                  const dir = await ensureChunkDirAsync();
                  const target = `${dir}chunk-${Date.now()}.m4a`;
                  await FileSystem.copyAsync({ from: uri, to: target });
                  console.log('[rec] copied chunk to', target, 'bytes=', info.size);
                  await enqueueUpload(target);
                } else {
                  console.log('[rec] no valid file to copy');
                }
              } catch (e: any) {
                console.log('[rec] background copy/upload failed', e?.message);
              }
            })();
          } else {
            console.log('[rec] no uri after stop');
          }
        } catch (e: any) {
          console.log('[rec] stopAndSendChunk error', e?.message);
          stopInProgressRef.current = false;
        }
      };

      const driveLoop = async () => {
        console.log('[rec] driveLoop started, isRecording:', isRecordingRef.current);
        if (!isRecordingRef.current) {
          console.log('[rec] driveLoop exiting - not recording');
          return;
        }
        // Stop current and send previous buffer while immediately restarting recording
        console.log('[rec] driveLoop calling stopAndSendChunk');
        await stopAndSendChunk();
        console.log('[rec] driveLoop after stopAndSendChunk, isRecording:', isRecordingRef.current);
        if (!isRecordingRef.current) {
          console.log('[rec] driveLoop exiting after stopAndSendChunk - not recording');
          return;
        }
        nextSendAtRef.current = Date.now() + CHUNK_INTERVAL_MS;
        console.log('[rec] driveLoop scheduling next iteration in', CHUNK_INTERVAL_MS, 'ms');
        cloudChunkTimeoutRef.current = setTimeout(driveLoop, CHUNK_INTERVAL_MS) as any;
      };

      setIsRecording(true);
      setHasStoppedRecording(false); // Reset stopped state when starting new recording
      setIsStarting(false); // Clear starting state once recording begins

      // Start duration timer
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);
      durationTimerRef.current = setInterval(() => {
        if (recordingStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
          setRecordingDuration(elapsed);
        }
      }, 1000) as any;
      // Wait a moment for the state to propagate to refs
      await new Promise(resolve => setTimeout(resolve, 10));
      // kick off
      await startChunk();
      nextSendAtRef.current = Date.now() + CHUNK_INTERVAL_MS;
      cloudChunkTimeoutRef.current = setTimeout(driveLoop, CHUNK_INTERVAL_MS) as any;
      // UI ticker for countdown
      if (uiTickerRef.current) try { clearInterval(uiTickerRef.current as any); } catch { }
      // countdown ticker removed
      // ticker removed
      uiTickerRef.current = setInterval(() => { }, 250) as any;
    } catch (e: any) {
      console.log('[rec] start error', e?.message);
      setIsStarting(false); // Clear starting state on error
      Alert.alert('Error', e?.message || 'Failed to start recorder');
    }
  }, [recorderState, isRecording, isStarting, apiBaseUrl, ensureChunkDirAsync, title, customPrompt, enqueueUpload, recordingOptions, resetForNewSession]);

  // Handle stopping process in useEffect to avoid navigation context issues
  useEffect(() => {
    if (!isStopping) return;

    const performStopAndFlush = async () => {
      console.log('[rec] stopAndFlush - cleaning up timers and capturing final chunk');
      if (cloudChunkTimeoutRef.current) {
        try { clearTimeout(cloudChunkTimeoutRef.current as any); } catch { }
        cloudChunkTimeoutRef.current = null;
      }
      if (uiTickerRef.current) {
        try { clearInterval(uiTickerRef.current as any); } catch { }
        uiTickerRef.current = null;
      }
      // Stop duration timer
      if (durationTimerRef.current) {
        try { clearInterval(durationTimerRef.current as any); } catch { }
        durationTimerRef.current = null;
      }
      recordingStartTimeRef.current = null;
      nextSendAtRef.current = 0;

      let finalUri: string | null = null;
      try {
        if (stopInProgressRef.current) {
          await new Promise(r => setTimeout(r, 500));
        }
        console.log('[rec] manual stop() - attempting to capture final chunk (isNativeRecorderActive:', isNativeRecorderActiveRef.current, ')');
        try {
          finalUri = await audioRecorderRef.current?.stop();
          console.log('[rec] final uri from stop():', finalUri);
          if (!finalUri) {
            const fallbackUri = (audioRecorderRef.current as any)?.uri || (recorderState as any)?.url;
            finalUri = fallbackUri;
            if (finalUri) console.log('[rec] using fallback uri:', finalUri);
            else {
              try {
                const dir = await ensureChunkDirAsync();
                const files = await FileSystem.readDirectoryAsync(dir);
                const recentRecordings = files
                  .filter(f => f.startsWith('recording-') && f.endsWith('.m4a'))
                  .map(f => ({ name: f, path: `${dir}${f}` }))
                  .sort((a, b) => b.name.localeCompare(a.name))
                  .slice(0, 1);
                if (recentRecordings.length > 0) {
                  finalUri = recentRecordings[0].path;
                  console.log('[rec] found recent recording file:', finalUri);
                }
              } catch (e: any) {
                console.log('[rec] failed to find recent recording files:', e?.message);
              }
            }
          }
          isNativeRecorderActiveRef.current = false;
        } catch (e: any) {
          console.log('[rec] stop() failed:', e?.message);
        }
      } catch (e: any) {
        console.log('[rec] error stopping final chunk:', e?.message);
      }

      if (finalUri) {
        console.log('[rec] processing final chunk:', finalUri);
        try {
          const info = await FileSystem.getInfoAsync(finalUri);
          const fileSize = (info as any).size || 0;
          if (info.exists && fileSize > 50) {
            await enqueueUpload(finalUri as string);
          } else {
            await enqueueUpload(finalUri as string);
          }
        } catch (e: any) {
          console.log('[rec] error processing final chunk:', e?.message);
          await enqueueUpload(finalUri as string);
        }
      } else {
        console.log('[rec] no final chunk to process!');
      }

      try {
        const sid = sessionIdRef.current;
        if (sid) {
          const supabase = getSupabase();
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token || '';
          const res = await fetch(`${apiBaseUrl}/api/sessions/${sid}/stop`, {
            method: 'POST',
            headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          });
          if (!res.ok) console.log('[session] stop failed', await res.json().catch(() => ({})));
          lastSessionIdRef.current = sid;
        }
      } catch { }

      // Auto-finalize the session
      const autoFinalize = async () => {
        const sid = lastSessionIdRef.current;
        if (!sid) return;

        try {
          setIsFinalizing(true);
          const supabase = getSupabase();
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token || '';

          // Update title/prompt if provided
          if ((title && title.trim()) || (customPrompt && customPrompt.trim())) {
            fetch(`${apiBaseUrl}/api/sessions/${sid}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
              body: JSON.stringify({ title: title?.trim() || null, summary_prompt: customPrompt?.trim() || null }),
            }).catch(() => { });
          }

          // Start finalization
          await fetch(`${apiBaseUrl}/api/sessions/${sid}/finalize`, {
            method: 'POST',
            headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          });

          console.log('[rec] auto-finalization started for session:', sid);
          // Delay before showing completion to avoid flash
          setTimeout(() => {
            setIsFinalizing(false);
            setJustSaved(true);
            // Clean up session state for next recording
            setTimeout(() => {
              setJustSaved(false);
              // Reset all recording-related state for fresh start
              sessionIdRef.current = null; // Clear session ID after finalization
              resetForNewSession();
              setIsStarting(false); // Clear starting state at end of complete session
            }, 2000); // Reduced from 4s to 2s
          }, 500);
        } catch (e: any) {
          console.log('[rec] auto-finalize failed:', e?.message);
          setIsFinalizing(false);
        }
      };

      // Finally, transition the UI back to the idle state
      setHasStoppedRecording(true);
      setIsStopping(false);
      // Complete the recording state transition
      setIsRecording(false);

      // Auto-finalize after a short delay to let uploads settle
      setTimeout(() => {
        autoFinalize();
      }, 1000);
    };

    performStopAndFlush();
  }, [isStopping, audioRecorder, recorderState, enqueueUpload, apiBaseUrl, ensureChunkDirAsync]);

  // Reset button removed for simpler UX

  if (!authChecked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!isAuthed) return <Redirect href="/login" />;

  // Preview removed; we show only live snippets in recent list

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: 16
      }}
    >
      <View className="gap-4">
        <View className="items-center">
          <ThemedText type="title" className="text-gray-900 dark:text-white">Recorder</ThemedText>
          <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-1">
            Tap to start recording your session
          </ThemedText>
        </View>

        <View className="mt-4 items-center justify-center">
          <View className="h-32 w-32 items-center justify-center relative">
            {/* Outer ring for visual enhancement */}
            <View className={`absolute h-32 w-32 rounded-full border-2 ${effectivelyRecording ? 'border-red-200 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`} pointerEvents="none" />

            {/* Pulse animation - DISABLED FOR TESTING */}
            {/* {effectivelyRecording ? (
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  height: 140,
                  width: 140,
                  borderRadius: 9999,
                  backgroundColor: '#ef4444',
                  opacity: pulseOpacity as any,
                  transform: [{ scale: pulseScale as any }],
                }}
              />
            ) : null} */}

            {/* Main button with press feedback */}
            <Pressable
              onPress={effectivelyRecording ? () => {
                // Add slight delay to show press feedback before state change
                setTimeout(() => setIsStopping(true), 50);
              } : () => {
                // Show immediate feedback, then start recording
                setIsStarting(true);
                startRecording();
              }}
              disabled={isStarting || isStopping || isFinalizing}
              className={`h-24 w-24 rounded-full items-center justify-center border-4 ${effectivelyRecording && !isStopping
                ? 'bg-red-500 border-red-300'
                : (isStarting || isStopping || isFinalizing)
                  ? 'bg-emerald-500 border-emerald-300'
                  : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'
                }`}
              accessibilityLabel={
                effectivelyRecording && !isStopping ? 'Stop recording'
                  : isStopping ? 'Stopping...'
                    : isFinalizing ? 'Processing...'
                      : isStarting ? 'Starting...'
                        : 'Start recording'
              }
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={({ pressed }) => [
                {
                  zIndex: 1,
                  transform: [{ scale: pressed && !isStarting && !isStopping && !isFinalizing ? 0.95 : 1 }],
                  opacity: (isStarting || isStopping || isFinalizing) ? 0.7 : (pressed ? 0.8 : 1),
                },
              ]}
              android_ripple={{
                color: effectivelyRecording ? '#ffffff40' : '#10b98140',
                radius: 48,
                borderless: false
              }}
            >
              {effectivelyRecording && !isStopping ? (
                <Ionicons name="stop" size={32} color="#ffffff" />
              ) : (isStarting || isStopping || isFinalizing) ? (
                <ActivityIndicator size="large" color="#ffffff" />
              ) : (
                <Ionicons name="mic" size={32} color="#374151" />
              )}
            </Pressable>
          </View>

          {/* Simplified status indicator - less flashing */}
          <View className="mt-6 items-center min-h-[44px] justify-center">
            {effectivelyRecording ? (
              <View className="flex-row items-center bg-green-50 dark:bg-green-900/20 px-4 py-2 rounded-full">
                <View className="w-2 h-2 bg-green-500 rounded-full mr-2" />
                <ThemedText className="text-green-700 dark:text-green-400 font-medium">
                  Recording {formatDuration(recordingDuration)}
                </ThemedText>
              </View>
            ) : (isStarting || isStopping) ? (
              <View className="flex-row items-center bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-full">
                <ActivityIndicator size="small" color="#10b981" />
                <ThemedText className="text-emerald-700 dark:text-emerald-400 font-medium ml-2">
                  {isStarting ? 'Starting…' : 'Stopping…'}
                </ThemedText>
              </View>
            ) : justSaved ? (
              <View className="flex-row items-center bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-full">
                <ThemedText className="text-emerald-700 dark:text-emerald-400 font-medium">Ready for next session</ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        {/* Reset removed */}

        {/* No preview buffer; live snippets appear below */}

        {/* Session Configuration - Only show when recording or processing */}
        {(effectivelyRecording || isFinalizing || justSaved) && (
          <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-5 border-2 border-gray-100 dark:border-gray-700/50">
            <ThemedText className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              {effectivelyRecording ? 'Recording Session' : (isFinalizing ? 'Processing Session' : 'Session Complete')}
            </ThemedText>

            <View className="gap-4">
              <View className="gap-2">
                <ThemedText className="text-gray-700 dark:text-gray-300 font-medium text-sm">Session title (optional)</ThemedText>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Weekly sync with team"
                  className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50"
                />
              </View>
              <View className="gap-2">
                <ThemedText className="text-gray-700 dark:text-gray-300 font-medium text-sm">Quick titles from calendar</ThemedText>
                <View className="flex-row flex-wrap gap-2">
                  {eventsLoading ? (
                    <View className="flex-row items-center bg-gray-50 dark:bg-gray-700 px-3 py-1.5 rounded-lg">
                      <ActivityIndicator size="small" color="#6b7280" />
                      <ThemedText className="text-xs text-gray-500 dark:text-gray-400 ml-2">Loading events…</ThemedText>
                    </View>
                  ) : (events && events.length > 0 ? (
                    events.map((ev) => (
                      <Pressable
                        key={ev.id}
                        onPress={() => setTitle(ev.title || '')}
                        className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg"
                      >
                        <ThemedText className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                          {(ev.title || 'Untitled')} · {new Date(ev.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </ThemedText>
                      </Pressable>
                    ))
                  ) : (
                    <ThemedText className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 px-3 py-1.5 rounded-lg">
                      No upcoming events
                    </ThemedText>
                  ))}
                </View>
              </View>

              <View className="gap-2">
                <ThemedText className="text-gray-700 dark:text-gray-300 font-medium text-sm">AI Summary Instructions (optional)</ThemedText>
                <TextInput
                  value={customPrompt}
                  onChangeText={setCustomPrompt}
                  placeholder="Summarize action items and decisions, highlight blockers."
                  className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 min-h-[80px]"
                  multiline
                  textAlignVertical="top"
                />
              </View>
            </View>

            {/* Processing status */}
            {isFinalizing && (
              <View className="mt-4 flex-row items-center justify-center bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 rounded-xl border-2 border-emerald-200 dark:border-emerald-800">
                <ActivityIndicator size="small" color="#10b981" />
                <ThemedText className="text-emerald-700 dark:text-emerald-400 font-medium ml-2">Processing session...</ThemedText>
              </View>
            )}

            {justSaved && (
              <View className="mt-4 flex-row items-center justify-center bg-green-50 dark:bg-green-900/20 px-4 py-3 rounded-xl border-2 border-green-200 dark:border-green-800">
                <ThemedText className="text-green-700 dark:text-green-400 font-medium">✅ Session processed! Check Sessions tab for results.</ThemedText>
              </View>
            )}
          </View>
        )}

        {summaryText ? (
          <View className="bg-green-50 dark:bg-green-900/10 border-2 border-green-200 dark:border-green-800 rounded-2xl p-4">
            <ThemedText className="text-lg font-semibold text-green-800 dark:text-green-300 mb-2">Summary</ThemedText>
            <ThemedText className="text-green-700 dark:text-green-400 leading-relaxed">{summaryText}</ThemedText>
            {actionItems && actionItems.length > 0 ? (
              <View className="mt-3">
                <ThemedText className="text-base font-semibold text-green-800 dark:text-green-300 mb-2">Action items</ThemedText>
                {actionItems.map((it, idx) => (
                  <View key={idx} className="flex-row items-start mb-1">
                    <View className="w-1.5 h-1.5 bg-green-600 dark:bg-green-400 rounded-full mt-2 mr-2" />
                    <ThemedText className="text-green-700 dark:text-green-400 flex-1">{it}</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {recentTranscripts.length > 0 ? (
          <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-4 border-2 border-gray-100 dark:border-gray-700/50">
            <ThemedText className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">Live Transcription</ThemedText>
            <View className="gap-3">
              {recentTranscripts.map((t) => (
                <View key={t.seq} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 border-l-4 border-blue-500">
                  <ThemedText className="text-blue-600 dark:text-blue-400 text-xs font-medium mb-1">{t.timestamp}</ThemedText>
                  <ThemedText className="text-gray-800 dark:text-gray-200 leading-relaxed">{t.text}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

// styles removed; using Tailwind utility classes


