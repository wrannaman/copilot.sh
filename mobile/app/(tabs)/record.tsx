import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, ActivityIndicator } from 'react-native';
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
import Voice from '@react-native-voice/voice';

// Simple text-only "record" MVP to align with stateless 5s chunks approach
export default function RecordScreen() {
  const hasAudio = !!(AudioModule as any)?.requestRecordingPermissionsAsync;
  // Simple gate to avoid crashing in Expo Go where expo-audio native module isn't available
  if (!hasAudio) {
    return (
      <ParallaxScrollView headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }} headerImage={<ThemedView />}>
        <ThemedView style={styles.container}>
          <ThemedText type="title">Recorder</ThemedText>
          <ThemedText style={styles.statusIdle}>
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
  // Preview text buffer (type now, audio STT coming soon)
  const [recentTranscripts, setRecentTranscripts] = useState<{ seq: number; text: string; timestamp: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // liveTranscript removed; UI shows pending buffer instead
  const [inProgressText, setInProgressText] = useState<string>('');
  const isRecordingRef = useRef(false);
  const isSendingRef = useRef(false);
  const inProgressTextRef = useRef<string>('');
  const lastTranscriptRef = useRef<string>('');
  const sentCharsRef = useRef<number>(0);
  const ROLLBACK_CHARS = 15; // small overlap to absorb STT corrections
  const lastSentTextRef = useRef<string>('');

  function removeOverlapWords(oldText: string, newText: string, maxOverlapWords: number = 20): string {
    const oldWords = (oldText || '').trim().split(' ').filter(Boolean);
    const newWords = (newText || '').trim().split(' ').filter(Boolean);
    const maxK = Math.min(maxOverlapWords, oldWords.length, newWords.length);
    for (let k = maxK; k > 0; k--) {
      let match = true;
      for (let i = 0; i < k; i++) {
        if (oldWords[oldWords.length - k + i] !== newWords[i]) { match = false; break; }
      }
      if (match) {
        return newWords.slice(k).join(' ');
      }
    }
    return newWords.join(' ');
  }
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isSendingRef.current = isSending; }, [isSending]);
  useEffect(() => { inProgressTextRef.current = inProgressText; }, [inProgressText]);
  // Show pending buffer in UI
  const previewText = inProgressText;
  const USE_LOCAL_STT = true;

  const audioRecorder = useAudioRecorder({
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    ios: {
      outputFormat: IOSOutputFormat.LINEARPCM,
      audioQuality: AudioQuality.MEDIUM,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
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

  const sendChunk = useCallback(async (uri: string) => {
    try {
      setIsSending(true);
      console.log('[cloud] sending chunk', { uri });
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const form = new FormData();
      const filename = uri.endsWith('.m4a') ? 'chunk.m4a' : 'chunk.wav';
      const type = uri.endsWith('.m4a') ? 'audio/mp4' : 'audio/wav';
      try {
        const info = await FileSystem.getInfoAsync(uri);
        console.log('[rec] file info', info);
      } catch { }
      form.append('mode', 'cloud');
      // @ts-ignore RN FormData file
      form.append('chunk', { uri, name: filename, type });
      form.append('mimeType', type);
      console.log('[rec] POST', `${apiBaseUrl}/api/transcribe`, { filename, type });
      const res = await fetch(`${apiBaseUrl}/api/transcribe`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: form as any,
      });
      const data = await res.json().catch(() => ({}));
      console.log('[cloud] response', res.status, data);
      if (!res.ok) {
        throw new Error(data?.message || `Failed: ${res.status}`);
      }
      const finalized = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : '';
      if (finalized) {
        setRecentTranscripts(prev => [
          { seq: Date.now(), text: finalized, timestamp: new Date().toLocaleTimeString() },
          ...prev.slice(0, 9)
        ]);
      }
      console.log('[cloud] saved');
    } catch (e: any) {
      console.log('[cloud] upload failed', e?.message);
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setIsSending(false);
    }
  }, [apiBaseUrl]);

  const sendText = useCallback(async (textToSend: string): Promise<string | null> => {
    try {
      if (!textToSend || !textToSend.trim()) return null;
      console.log('[send] POST /api/transcribe text length=', textToSend.length);
      setIsSending(true);
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const form = new FormData();
      form.append('mode', 'browser');
      form.append('text', textToSend);
      const res = await fetch(`${apiBaseUrl}/api/transcribe`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: form as any,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Failed: ${res.status}`);
      const finalized = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : textToSend;
      if (finalized) {
        console.log('[send] saved transcript text:', finalized);
        setRecentTranscripts(prev => [
          { seq: Date.now(), text: finalized, timestamp: new Date().toLocaleTimeString() },
          ...prev.slice(0, 9)
        ]);
      }
      console.log('[send] saved');
      return textToSend;
    } catch (e: any) {
      console.log('[sendText] failed', e?.message);
      Alert.alert('Error', e?.message || 'Failed to save');
      return null;
    } finally {
      setIsSending(false);
    }
  }, [apiBaseUrl]);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        return Alert.alert('Microphone denied');
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      if (USE_LOCAL_STT) {
        try { (Voice as any)?.removeAllListeners?.(); } catch { }
        try { await (Voice as any)?.requestPermissions?.(); } catch { }
        Voice.onSpeechStart = () => { console.log('[stt] onSpeechStart'); };
        const handleTranscriptUpdate = (newFullText: string) => {
          // Only update if the text has actually changed
          if (newFullText === lastTranscriptRef.current) return;

          lastTranscriptRef.current = newFullText;
          // If STT regressed (shorter than what we've marked sent), roll anchor back inside bounds
          if (newFullText.length < sentCharsRef.current) {
            sentCharsRef.current = Math.max(0, newFullText.length - ROLLBACK_CHARS);
          }
          const delta = newFullText.substring(sentCharsRef.current);
          setInProgressText(delta);
        };

        Voice.onSpeechPartialResults = (e: any) => {
          const parts: string[] = e?.value || [];
          if (parts && parts.length) {
            const text = (parts[0] || '').trim();
            handleTranscriptUpdate(text);
          }
        };
        Voice.onSpeechResults = (e: any) => {
          const lines: string[] = e?.value || [];
          const text = (lines[0] || '').trim();
          if (text) {
            console.log('[stt] final result:', text);
            handleTranscriptUpdate(text);
          }
        };
        Voice.onSpeechError = (e: any) => {
          console.log('[stt] error:', e);
        };
        await (Voice as any).start?.('en-US');
        lastTranscriptRef.current = '';
        setIsRecording(true);
        // Start periodic text send
        if (sendTimerRef.current) try { clearInterval(sendTimerRef.current as any); } catch { }
        sendTimerRef.current = setInterval(() => {
          // Timer's only job is to send the state. No recalculations.
          if (!isRecordingRef.current || isSendingRef.current || !inProgressTextRef.current.trim()) {
            return;
          }

          const candidate = inProgressTextRef.current;
          const pruned = removeOverlapWords(lastSentTextRef.current, candidate);
          if (!pruned.trim()) return;

          const textToSend = pruned;
          console.log('[timer] sending buffer:', textToSend.slice(0, 50) + '...');
          sendText(textToSend).then(sent => {
            if (!sent) return;

            // Track the last exact text we successfully sent to strip future overlaps
            lastSentTextRef.current = sent;

            // Advance numeric anchor by exactly what we sent, then apply small rollback overlap
            let tentative = sentCharsRef.current + sent.length - ROLLBACK_CHARS;
            tentative = Math.max(0, tentative);

            // Subtle fix: snap the anchor to the previous word boundary within a small lookback window
            const fullNow = lastTranscriptRef.current || '';
            const clamp = Math.min(tentative, fullNow.length);
            const LOOKBACK = 15;
            const windowStart = Math.max(0, clamp - LOOKBACK);
            const slice = fullNow.slice(windowStart, clamp);
            // Find last whitespace-like boundary (space or punctuation)
            let boundaryIdx = -1;
            for (let i = slice.length - 1; i >= 0; i--) {
              const ch = slice[i];
              if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '.' || ch === ',' || ch === '!' || ch === '?' || ch === ';' || ch === ':') {
                boundaryIdx = i;
                break;
              }
            }
            sentCharsRef.current = boundaryIdx >= 0 ? (windowStart + boundaryIdx + 1) : clamp;

            // Clear the UI buffer since we sent it; next STT update will rebuild delta from anchor
            setInProgressText('');
          }).catch(() => { });
        }, 5000) as any;
        return;
      }
      console.log('[rec] prepareToRecordAsync…');
      await audioRecorder.prepareToRecordAsync();
      console.log('[rec] record()');
      audioRecorder.record();
      setIsRecording(true);
      if (sendTimerRef.current) try { clearInterval(sendTimerRef.current as any); } catch { }
      sendTimerRef.current = setInterval(async () => {
        console.log('[rec] tick', { isRec: recorderState.isRecording, isSending });
        if (isSending) return;
        if (recorderState.isRecording) {
          try {
            console.log('[rec] stop()…');
            await audioRecorder.stop();
            console.log('[rec] stopped uri', audioRecorder.uri);
            if (audioRecorder.uri) {
              await sendChunk(audioRecorder.uri as string);
            }
          } catch { }
        } else {
          try {
            console.log('[rec] re-prepare');
            await audioRecorder.prepareToRecordAsync();
            console.log('[rec] re-record');
            audioRecorder.record();
          } catch { }
        }
      }, 5000) as any;
    } catch (e: any) {
      console.log('[rec] start error', e?.message);
      Alert.alert('Error', e?.message || 'Failed to start recorder');
    }
  }, [audioRecorder, recorderState.isRecording, isRecording, isSending, sendChunk, USE_LOCAL_STT, sendText]);

  const stopAndFlush = useCallback(async () => {
    if (sendTimerRef.current) {
      try { clearInterval(sendTimerRef.current as any); } catch { }
      sendTimerRef.current = null;
    }
    setIsRecording(false);
    if (USE_LOCAL_STT) {
      // Stop timer first
      if (sendTimerRef.current) {
        try { clearInterval(sendTimerRef.current as any); } catch { }
        sendTimerRef.current = null;
      }
      try { await (Voice as any).stop?.(); } catch { }
      try { await (Voice as any).destroy?.(); } catch { }
      // Flush any remaining pending buffer (from state)
      const finalText = inProgressText.trim();
      if (finalText) { try { await sendText(finalText); } catch { } }
      lastTranscriptRef.current = '';
      sentCharsRef.current = 0;
      setInProgressText('');
      return;
    }
    try {
      console.log('[rec] manual stop()');
      await audioRecorder.stop();
      console.log('[rec] stopped uri', audioRecorder.uri);
      if (audioRecorder.uri) {
        await sendChunk(audioRecorder.uri as string);
      }
    } catch { }
  }, [audioRecorder, sendChunk, USE_LOCAL_STT, sendText, inProgressText]);

  if (!authChecked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!isAuthed) return <Redirect href="/login" />;

  // Preview removed

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={<ThemedView />}
    >
      <ThemedView style={styles.container}>
        <ThemedText type="title">Recorder</ThemedText>
        <View style={styles.statusRow}>
          {isRecording ? (
            <ThemedText style={styles.statusRecording}>● Recording</ThemedText>
          ) : isSending ? (
            <ThemedText style={styles.statusSaving}>Saving…</ThemedText>
          ) : (
            <ThemedText style={styles.statusIdle}>Idle</ThemedText>
          )}
          <Pressable
            onPress={isRecording ? stopAndFlush : startRecording}
            style={[styles.micButton, isRecording ? styles.micStop : styles.micStart]}
            accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {isRecording ? (
              <Ionicons name="stop" size={32} color="#ffffff" />
            ) : (
              <Ionicons name="mic" size={32} color="#ffffff" />
            )}
          </Pressable>
        </View>

        {previewText ? (
          <View style={styles.preview}>
            <ThemedText style={styles.previewLabel}>Current transcript</ThemedText>
            <ThemedText>{previewText}</ThemedText>
          </View>
        ) : null}

        {recentTranscripts.length > 0 ? (
          <View style={styles.recent}>
            <ThemedText type="defaultSemiBold">Recent transcripts</ThemedText>
            {recentTranscripts.map((t) => (
              <View key={t.seq} style={styles.recentItem}>
                <ThemedText style={styles.recentTime}>{t.timestamp}</ThemedText>
                <ThemedText>{t.text}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  statusRow: {
    marginTop: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusIdle: {
    color: '#6b7280',
  },
  statusSaving: {
    color: '#6b7280',
  },
  statusRecording: {
    color: '#059669',
    fontWeight: '600',
  },
  micButton: {
    height: 72,
    width: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micPressed: {
    opacity: 0.9,
  },
  micStart: {
    backgroundColor: '#111827',
  },
  micStop: {
    backgroundColor: '#dc2626',
  },
  inputWrap: {
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 8,
    overflow: 'hidden',
  },
  input: {
    minHeight: 120,
    padding: 12,
    color: '#111111',
  },
  preview: {
    gap: 6,
    borderWidth: 1,
    borderColor: '#eeeeee',
    borderRadius: 8,
    padding: 10,
  },
  previewLabel: {
    color: '#6b7280',
    fontSize: 12,
  },
  recent: {
    gap: 6,
    marginTop: 4,
  },
  recentItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  recentTime: {
    color: '#6b7280',
    fontSize: 12,
    marginBottom: 2,
  },
  wordsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  wordChip: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});


