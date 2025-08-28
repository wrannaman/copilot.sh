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
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
  useAudioRecorderState,
  IOSOutputFormat,
  AudioQuality,
} from 'expo-audio';

// Simple text-only "record" MVP to align with stateless 5s chunks approach
export default function RecordScreen() {
  // Preview text buffer (type now, audio STT coming soon)
  const [recentTranscripts, setRecentTranscripts] = useState<{ seq: number; text: string; timestamp: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [chunksSent, setChunksSent] = useState(0);
  const [lastStatus, setLastStatus] = useState<string>('');
  const [wordsSoFar, setWordsSoFar] = useState<string[]>([]);

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
  } as any);
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
      setLastStatus('Uploading…');
      console.log('[rec] sending chunk', { uri });
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
      console.log('[rec] response', res.status, data);
      if (!res.ok) {
        throw new Error(data?.message || `Failed: ${res.status}`);
      }
      const finalized = (data && typeof data.text === 'string' && data.text.trim()) ? data.text.trim() : '';
      if (finalized) {
        setRecentTranscripts(prev => [
          { seq: Date.now(), text: finalized, timestamp: new Date().toLocaleTimeString() },
          ...prev.slice(0, 9)
        ]);
        setWordsSoFar(prev => [...prev, ...finalized.split(/\s+/).filter(Boolean)]);
      }
      setChunksSent(c => c + 1);
      setLastStatus('Saved');
    } catch (e: any) {
      setLastStatus(e?.message || 'Upload failed');
      console.log('[rec] upload failed', e?.message);
      Alert.alert('Error', e?.message || 'Failed to save');
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
      console.log('[rec] prepareToRecordAsync…');
      await audioRecorder.prepareToRecordAsync();
      console.log('[rec] record()');
      audioRecorder.record();
      setIsRecording(true);
      if (sendTimerRef.current) try { clearInterval(sendTimerRef.current as any); } catch { }
      sendTimerRef.current = setInterval(async () => {
        console.log('[rec] tick', { isRec: recorderState.isRecording, isSending });
        if (!recorderState.isRecording || isSending) return;
        try {
          console.log('[rec] stop()…');
          await audioRecorder.stop();
          console.log('[rec] stopped uri', audioRecorder.uri);
          if (audioRecorder.uri) {
            await sendChunk(audioRecorder.uri as string);
          }
        } catch { }
        try {
          console.log('[rec] re-prepare');
          await audioRecorder.prepareToRecordAsync();
          console.log('[rec] re-record');
          audioRecorder.record();
        } catch { }
      }, 5000) as any;
    } catch (e: any) {
      console.log('[rec] start error', e?.message);
      Alert.alert('Error', e?.message || 'Failed to start recorder');
    }
  }, [audioRecorder, recorderState.isRecording, isRecording, isSending, sendChunk]);

  const stopAndFlush = useCallback(async () => {
    if (sendTimerRef.current) {
      try { clearInterval(sendTimerRef.current as any); } catch { }
      sendTimerRef.current = null;
    }
    setIsRecording(false);
    try {
      console.log('[rec] manual stop()');
      await audioRecorder.stop();
      console.log('[rec] stopped uri', audioRecorder.uri);
      if (audioRecorder.uri) {
        await sendChunk(audioRecorder.uri as string);
      }
    } catch { }
  }, [audioRecorder, sendChunk]);

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
            <ThemedText style={styles.statusRecording}>● Recording • Sends every 5s</ThemedText>
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

        <View style={{ marginTop: 8 }}>
          <ThemedText type="defaultSemiBold">System feedback</ThemedText>
          <ThemedText>Chunks sent: {chunksSent} {isSending ? '(uploading…) ' : ''}</ThemedText>
          {lastStatus ? <ThemedText>Status: {lastStatus}</ThemedText> : null}
        </View>

        {wordsSoFar.length > 0 ? (
          <View style={{ gap: 6 }}>
            <ThemedText type="defaultSemiBold">Words so far</ThemedText>
            <View style={styles.wordsWrap}>
              {wordsSoFar.slice(-60).map((w, i) => (
                <View key={i} style={styles.wordChip}><ThemedText>{w}</ThemedText></View>
              ))}
            </View>
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


