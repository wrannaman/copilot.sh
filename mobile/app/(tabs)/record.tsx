import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View, ActivityIndicator, TextInput } from 'react-native';
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
  const [sendCountdownMs, setSendCountdownMs] = useState(0);
  const CHUNK_INTERVAL_MS = 60000; // 60s
  const chunkDirRef = useRef<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [finalizeProcessed, setFinalizeProcessed] = useState<number | null>(null);
  const [finalizeTotal, setFinalizeTotal] = useState<number | null>(null);
  const [summaryText, setSummaryText] = useState<string>('');
  const [actionItems, setActionItems] = useState<string[]>([]);
  const finalizePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');

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

  const sendChunk = useCallback(async (uri: string) => {
    try {
      setIsSending(true);
      console.log('[session] sending chunk', { uri });
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
      form.append('seq', String(seqRef.current));
      console.log('[rec] POST', `${apiBaseUrl}/api/sessions/${currentSessionId}/chunk`, { filename, type, seq: seqRef.current });
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
      // Increment seq after successful upload
      seqRef.current = seqRef.current + 1;
      console.log('[session] chunk saved');
    } catch (e: any) {
      console.log('[session] upload failed', e?.message);
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setIsSending(false);
    }
  }, [apiBaseUrl, stopRecordingImmediately]);

  // No text sending in MVP

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        return Alert.alert('Microphone denied');
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      // Create session first
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const createRes = await fetch(`${apiBaseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
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

      // Drive explicit 10s chunks using a simple stop→send→restart loop
      const getRecordingUri = (): string | null => {
        const rAny: any = audioRecorder as any;
        const direct = (audioRecorder as any)?.uri || rAny?.url || (recorderState as any)?.url;
        return typeof direct === 'string' && direct.length > 0 ? direct : null;
      };

      const startChunk = async () => {
        try {
          console.log('[rec] prepareToRecordAsync…');
          await audioRecorder.prepareToRecordAsync();
          console.log('[rec] record()');
          audioRecorder.record();
          isNativeRecorderActiveRef.current = true;
        } catch (e: any) {
          console.log('[rec] startChunk error', e?.message);
        }
      };

      const stopAndSendChunk = async () => {
        try {
          console.log('[rec] stop()…');
          await audioRecorder.stop();
          isNativeRecorderActiveRef.current = false;
          const uri = getRecordingUri();
          console.log('[rec] stopped uri', uri);
          let finalUri: string | null = uri;
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
          // Restart recording after we safely copied the finished file
          await startChunk();
          // Send copied chunk in background
          if (finalUri) {
            sendChunk(finalUri).catch(() => { });
          } else {
            console.log('[rec] no uri after stop');
          }
        } catch (e: any) {
          console.log('[rec] stopAndSendChunk error', e?.message);
        }
      };

      const driveLoop = async () => {
        if (!isRecordingRef.current) return;
        if (!isNativeRecorderActiveRef.current) {
          await startChunk();
        } else {
          await stopAndSendChunk();
        }
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
      uiTickerRef.current = setInterval(() => {
        if (!isRecordingRef.current) return;
        const remaining = Math.max(0, (nextSendAtRef.current || 0) - Date.now());
        setSendCountdownMs(remaining);
      }, 200) as any;
    } catch (e: any) {
      console.log('[rec] start error', e?.message);
      Alert.alert('Error', e?.message || 'Failed to start recorder');
    }
  }, [audioRecorder, recorderState, isRecording, sendChunk, apiBaseUrl, ensureChunkDirAsync]);

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
    setSendCountdownMs(0);
    setIsRecording(false);
    try {
      console.log('[rec] manual stop()');
      await audioRecorder.stop();
      console.log('[rec] stopped uri', audioRecorder.uri);
      const rAny: any = audioRecorder as any;
      const uri = (audioRecorder as any)?.uri || rAny?.url || (recorderState as any)?.url;
      if (uri) {
        await sendChunk(uri as string);
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
        setLastSessionId(sid);
      }
    } catch { }
    // reset session refs
    sessionIdRef.current = null;
    seqRef.current = 0;
  }, [audioRecorder, recorderState, sendChunk, apiBaseUrl]);

  const onReset = useCallback(() => {
    // Clear UI
    setRecentTranscripts([]);
    console.log('[reset] cleared recent transcripts');
  }, []);

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
          {isRecording ? (
            <ThemedText className="text-gray-500 dark:text-gray-400 mt-1">
              Next send in {Math.ceil(sendCountdownMs / 1000)}s
            </ThemedText>
          ) : null}
        </View>

        <View className="mt-4 flex-row items-center justify-end">
          <Pressable
            onPress={onReset}
            className="h-10 px-3 border border-gray-200 rounded-lg items-center justify-center mr-2 bg-white dark:bg-zinc-900 dark:border-zinc-800"
            accessibilityLabel={'Reset'}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="refresh" size={20} color="#374151" />
          </Pressable>
        </View>

        {/* No preview buffer; live snippets appear below */}

        {/* Finalize & Summarize controls */}
        {!isRecording ? (
          <View className="mt-3 gap-2">
            <ThemedText className="text-gray-500 dark:text-gray-400 text-xs">Custom summary prompt</ThemedText>
            <TextInput
              value={customPrompt}
              onChangeText={setCustomPrompt}
              placeholder="e.g., Focus on decisions, owners, and dates."
              className="border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-foreground"
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
                    setFinalizeProcessed(null);
                    setFinalizeTotal(null);
                    setSummaryText('');
                    setActionItems([]);
                    const supabase = getSupabase();
                    const { data: sessionData } = await supabase.auth.getSession();
                    const accessToken = sessionData?.session?.access_token || '';
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
                        const parts = Number(statusJson?.parts || 0);
                        const processed = Number(statusJson?.processed || 0);
                        setFinalizeProcessed(processed);
                        setFinalizeTotal(parts || null);
                        const ready = String(statusJson?.status || '').toLowerCase() === 'ready';
                        if (ready || (parts > 0 && processed >= parts)) {
                          if (finalizePollRef.current) { try { clearInterval(finalizePollRef.current as any) } catch { } finalizePollRef.current = null }
                          setIsFinalizing(false);
                          // Summarize
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
                disabled={isRecording || isFinalizing || isSummarizing || !lastSessionId}
                className={`h-10 px-3 rounded-lg items-center justify-center ${isRecording || isFinalizing || isSummarizing || !lastSessionId ? 'bg-gray-300' : 'bg-zinc-900'}`}
                accessibilityLabel={'Finalize & Summarize'}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <ThemedText className="text-white">{isFinalizing ? 'Finalizing…' : (isSummarizing ? 'Summarizing…' : 'Finalize & Summarize')}</ThemedText>
              </Pressable>
              <View>
                {isFinalizing && finalizeTotal != null && finalizeProcessed != null ? (
                  <ThemedText className="text-xs text-gray-500 dark:text-gray-400">Processed {finalizeProcessed}/{finalizeTotal}</ThemedText>
                ) : null}
              </View>
            </View>
            {summaryText ? (
              <View className="mt-2 gap-1 border border-gray-200 dark:border-zinc-800 rounded-lg p-2">
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


