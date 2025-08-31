import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View, ActivityIndicator, TextInput, Animated, Easing } from 'react-native';
import { Redirect } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import ParallaxScrollView from '@/components/ParallaxScrollView';
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
      <ParallaxScrollView headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }} headerImage={<ThemedView />}>
        <ThemedView className="gap-3">
          <ThemedText type="title">Recorder</ThemedText>
          <ThemedText className="text-gray-500 dark:text-gray-400">
            Audio module unavailable. Build a dev client to enable recording.
          </ThemedText>
          <ThemedText>
            Run: npx expo run:ios (or EAS build) and open the built app instead of Expo Go.
          </ThemedText>
        </ThemedView>
      </ParallaxScrollView>
    );
  }
  return <RecordScreenInner />
}

function RecordScreenInner() {
  // Minimal session-based recorder with live caption snippets from server
  const [recentTranscripts, setRecentTranscripts] = useState<{ seq: number; text: string; timestamp: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
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

  const audioRecorder = useAudioRecorder({
    extension: '.m4a',
    sampleRate: 16000,
    numberOfChannels: 1,
    ios: {
      outputFormat: IOSOutputFormat.MPEG4AAC,
      audioQuality: AudioQuality.MEDIUM,
    },
  } as any, (status) => {
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
      setIsRecording(false);
      try { await audioRecorder.stop(); } catch { }
      isNativeRecorderActiveRef.current = false;
    } catch { }
  }, [audioRecorder]);

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
      // saved successfully
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      console.log('[session] upload failed', e?.message);
      if (msg.includes('no active session')) {
        // Stop recording immediately if session is missing
        try { await stopRecordingImmediately(); } catch { }
      }
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setIsSending(false);
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
        setIsSending(false);
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
          if (stopInProgressRef.current) return;
          console.log('[rec] prepareToRecordAsync…');
          await audioRecorderRef.current?.prepareToRecordAsync();
          console.log('[rec] record()');
          audioRecorderRef.current?.record();
          isNativeRecorderActiveRef.current = true;
        } catch (e: any) {
          console.log('[rec] startChunk error', e?.message);
        }
      };

      const stopAndSendChunk = async () => {
        try {
          if (!isNativeRecorderActiveRef.current) return;
          if (stopInProgressRef.current) return;
          stopInProgressRef.current = true;
          console.log('[rec] stop()…');
          await audioRecorderRef.current?.stop();
          isNativeRecorderActiveRef.current = false;
          const uri = getRecordingUri();
          console.log('[rec] stopped uri', uri);
          let finalUri: string | null = uri;
          // Immediately restart recording to avoid gaps
          await startChunk();
          // Copy and send old chunk in background
          try {
            if (uri) {
              const info = await FileSystem.getInfoAsync(uri);
              if (info.exists && info.size && info.size > 0) {
                const dir = await ensureChunkDirAsync();
                const target = `${dir}chunk-${Date.now()}.m4a`;
                await FileSystem.copyAsync({ from: uri, to: target });
                finalUri = target;
                console.log('[rec] copied chunk to', target, 'bytes=', info.size);
              }
            }
          } catch (e: any) {
            console.log('[rec] copy failed', e?.message);
          }
          if (finalUri) {
            await enqueueUpload(finalUri);
          } else {
            console.log('[rec] no uri after stop');
          }
        } catch (e: any) {
          console.log('[rec] stopAndSendChunk error', e?.message);
        } finally {
          stopInProgressRef.current = false;
        }
      };

      const driveLoop = async () => {
        if (!isRecordingRef.current) return;
        // Stop current and send previous buffer while immediately restarting recording
        await stopAndSendChunk();
        if (!isRecordingRef.current) return;
        nextSendAtRef.current = Date.now() + CHUNK_INTERVAL_MS;
        cloudChunkTimeoutRef.current = setTimeout(driveLoop, CHUNK_INTERVAL_MS) as any;
      };

      setIsRecording(true);
      // kick off
      await startChunk();
      nextSendAtRef.current = Date.now() + CHUNK_INTERVAL_MS;
      cloudChunkTimeoutRef.current = setTimeout(driveLoop, CHUNK_INTERVAL_MS) as any;
      // UI ticker for countdown
      if (uiTickerRef.current) try { clearInterval(uiTickerRef.current as any); } catch { }
      // countdown ticker removed
      // ticker removed
      uiTickerRef.current = setInterval(() => { }, 1000) as any;
    } catch (e: any) {
      console.log('[rec] start error', e?.message);
      Alert.alert('Error', e?.message || 'Failed to start recorder');
    }
  }, [recorderState, isRecording, apiBaseUrl, ensureChunkDirAsync, title, customPrompt, enqueueUpload]);

  const stopAndFlush = useCallback(async () => {
    if (cloudChunkTimeoutRef.current) {
      try { clearTimeout(cloudChunkTimeoutRef.current as any); } catch { }
      cloudChunkTimeoutRef.current = null;
    }
    if (uiTickerRef.current) {
      try { clearInterval(uiTickerRef.current as any); } catch { }
      uiTickerRef.current = null;
    }
    nextSendAtRef.current = 0;
    // countdown reset removed
    setIsRecording(false);
    try {
      if (stopInProgressRef.current) {
        // best-effort: wait briefly for in-flight stop
        await new Promise(r => setTimeout(r, 150));
      }
      console.log('[rec] manual stop()');
      try { await audioRecorderRef.current?.stop(); } catch { }
      console.log('[rec] stopped uri', audioRecorder.uri);
      const rAny: any = audioRecorder as any;
      const uri = (audioRecorder as any)?.uri || rAny?.url || (recorderState as any)?.url;
      if (uri) {
        // Route final chunk through the same queue to ensure MD5 dedupe and monotonic seq
        await enqueueUpload(uri as string);
      }
    } catch { }
    // Call stop on the session
    try {
      const sid = sessionIdRef.current;
      if (sid) {
        const supabase = getSupabase();
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token || '';
        const res = await fetch(`${apiBaseUrl}/api/sessions/${sid}/stop`, {
          method: 'POST',
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.log('[session] stop failed', data);
        }
        // Retain last session id for finalize/summarize
        lastSessionIdRef.current = sid;

        // Do not auto finalize; user will trigger Finalize & Summarize
      }
    } catch { }
    // Do not reset session refs here; allow queue to finish uploading final chunk(s)
  }, [audioRecorder, recorderState, enqueueUpload, apiBaseUrl]);

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
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={<ThemedView />}
    >
      <ThemedView className="gap-3">
        <ThemedText type="title">Recorder</ThemedText>
        <View className="mt-4 items-center justify-center">
          <Pressable
            onPress={isRecording ? stopAndFlush : startRecording}
            className={`h-24 w-24 rounded-full items-center justify-center ${isRecording ? 'bg-red-600' : 'bg-zinc-900'}`}
            accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {isRecording ? (
              <Ionicons name="stop" size={36} color="#ffffff" />
            ) : (
              <Ionicons name="mic" size={36} color="#ffffff" />
            )}
          </Pressable>
          {isRecording ? (
            <ThemedText className="text-green-600 font-semibold text-center mt-2">● Recording</ThemedText>
          ) : isSending ? (
            <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-2">Saving…</ThemedText>
          ) : (
            <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-2">Idle</ThemedText>
          )}
          {/* Countdown hidden for simpler UI */}
        </View>

        {/* Reset removed */}

        {/* No preview buffer; live snippets appear below */}

        {/* Finalize & Summarize (manual trigger) */}
        {!isRecording ? (
          <View className="mt-3 gap-2">
            <ThemedText className="text-gray-500 dark:text-gray-400 text-xs">Session title (optional)</ThemedText>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Weekly sync with team"
                className="flex-1 border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-foreground"
              />
            </View>
            <View className="flex-row flex-wrap gap-2 items-center">
              {eventsLoading ? (
                <ThemedText className="text-xs text-gray-500 dark:text-gray-400">Loading events…</ThemedText>
              ) : (events && events.length > 0 ? (
                events.map((ev) => (
                  <Pressable
                    key={ev.id}
                    onPress={() => setTitle(ev.title || '')}
                    className="px-2 py-1 rounded border border-gray-200 dark:border-zinc-800"
                  >
                    <ThemedText className="text-xs">{(ev.title || 'Untitled')} · {new Date(ev.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</ThemedText>
                  </Pressable>
                ))
              ) : (
                <ThemedText className="text-xs text-gray-500 dark:text-gray-400">No upcoming events</ThemedText>
              ))}
            </View>

            <ThemedText className="text-gray-500 dark:text-gray-400 text-xs">AI Summary Instructions (optional)</ThemedText>
            <TextInput
              value={customPrompt}
              onChangeText={setCustomPrompt}
              placeholder="Summarize action items and decisions, highlight blockers."
              className="border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-foreground"
              multiline
            />

            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={async () => {
                  try {
                    const sid = lastSessionIdRef.current;
                    if (!sid) {
                      Alert.alert('No session', 'Nothing to finalize.');
                      return;
                    }
                    if (finalizePollRef.current) { try { clearInterval(finalizePollRef.current as any) } catch { } finalizePollRef.current = null }
                    setIsFinalizing(true);
                    // no progress displayed
                    setSummaryText('');
                    setActionItems([]);
                    const supabase = getSupabase();
                    const { data: sessionData } = await supabase.auth.getSession();
                    const accessToken = sessionData?.session?.access_token || '';
                    // Update title/prompt just in case
                    if ((title && title.trim()) || (customPrompt && customPrompt.trim())) {
                      fetch(`${apiBaseUrl}/api/sessions/${sid}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
                        body: JSON.stringify({ title: title?.trim() || null, summary_prompt: customPrompt?.trim() || null }),
                      }).catch(() => { });
                    }
                    // Kick off finalize once
                    await fetch(`${apiBaseUrl}/api/sessions/${sid}/finalize`, {
                      method: 'POST',
                      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
                    }).catch(() => { });
                    // Poll status and nudge finalize
                    finalizePollRef.current = setInterval(async () => {
                      try {
                        const statusRes = await fetch(`${apiBaseUrl}/api/sessions/${sid}/status`, {
                          headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
                        });
                        const statusJson = await statusRes.json().catch(() => ({}));
                        const ready = String(statusJson?.status || '').toLowerCase() === 'ready';
                        if (ready) {
                          if (finalizePollRef.current) { try { clearInterval(finalizePollRef.current as any) } catch { } finalizePollRef.current = null }
                          setIsFinalizing(false);
                          // Summarize with prompt
                          setIsSummarizing(true);
                          const body: any = customPrompt && customPrompt.trim() ? { prompt: customPrompt.trim() } : {};
                          const sumRes = await fetch(`${apiBaseUrl}/api/sessions/${sid}/summarize`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
                            body: JSON.stringify(body),
                          });
                          const sumJson = await sumRes.json().catch(() => ({}));
                          if (!sumRes.ok) {
                            Alert.alert('Summarize failed', sumJson?.message || 'Please try again.');
                          } else {
                            const summary = String(sumJson?.summary || '').trim();
                            const items = Array.isArray(sumJson?.action_items) ? sumJson.action_items.filter((s: any) => typeof s === 'string') : [];
                            setSummaryText(summary);
                            setActionItems(items);
                          }
                          setIsSummarizing(false);
                        } else {
                          // Nudge finalize again in background
                          fetch(`${apiBaseUrl}/api/sessions/${sid}/finalize`, {
                            method: 'POST',
                            headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
                          }).catch(() => { });
                        }
                      } catch (e: any) {
                        console.log('[finalize] poll error', e?.message);
                      }
                    }, 3000) as any;
                  } catch (e: any) {
                    setIsFinalizing(false);
                    setIsSummarizing(false);
                    Alert.alert('Error', e?.message || 'Finalize failed');
                  }
                }}
                disabled={isRecording || isFinalizing || isSummarizing || !lastSessionIdRef.current}
                className={`h-10 px-3 rounded-lg items-center justify-center ${isRecording || isFinalizing || isSummarizing || !lastSessionIdRef.current ? 'bg-gray-300' : 'bg-zinc-900'} text-white dark:text-gray-50`}
                accessibilityLabel={'Finalize & Summarize'}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <ThemedText className="text-white">
                  {isFinalizing ? 'Finalizing…' : (isSummarizing ? 'Summarizing…' : 'Finalize & Summarize')}
                </ThemedText>
              </Pressable>
            </View>

            {summaryText ? (
              <View className="mt-1 gap-1 border border-gray-200 dark:border-zinc-800 rounded-lg p-2">
                <ThemedText type="defaultSemiBold">Summary</ThemedText>
                <ThemedText>{summaryText}</ThemedText>
                {actionItems && actionItems.length > 0 ? (
                  <View className="mt-1">
                    <ThemedText type="defaultSemiBold">Action items</ThemedText>
                    {actionItems.map((it, idx) => (
                      <ThemedText key={idx}>• {it}</ThemedText>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {recentTranscripts.length > 0 ? (
          <View className="gap-1 mt-1">
            <ThemedText type="defaultSemiBold">Recent transcripts</ThemedText>
            {recentTranscripts.map((t) => (
              <View key={t.seq} className="py-1.5 border-b border-gray-100 dark:border-zinc-800">
                <ThemedText className="text-gray-500 dark:text-gray-400 text-xs mb-0.5">{t.timestamp}</ThemedText>
                <ThemedText>{t.text}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </ThemedView>
    </ParallaxScrollView>
  );
}

// styles removed; using Tailwind utility classes


