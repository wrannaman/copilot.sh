import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View, ActivityIndicator, TextInput, Animated, Easing, ScrollView } from 'react-native';

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
  // Single continuous recording approach - no chunks
  // TEMPORARILY DISABLED useSafeAreaInsets to fix navigation context issue
  // const insets = useSafeAreaInsets();
  const insets = { top: 44, bottom: 20, left: 0, right: 0 }; // Fixed safe area values
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [isAuthed, setIsAuthed] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
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
    // Don't clear isStarting here - it's managed by the button press flow
    setIsStopping(false);
    setIsUploading(false);

    // UI States
    setJustSaved(false);
    setIsFinalizing(false);
    setRecordingDuration(0);

    // Clear form fields for fresh session
    setTitle('');
    setCustomPrompt('');

    // Refs - don't reset sessionIdRef here as it's needed for auto-finalize
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

  // refs for state mirrors
  const isRecordingRef = useRef(false);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

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
  const audioRecorderRef = useRef<any>(null);
  useEffect(() => { audioRecorderRef.current = audioRecorder; }, [audioRecorder]);

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

  // Upload audio file directly to Supabase storage
  const uploadToSupabase = useCallback(async (uri: string, sessionId: string, orgId: string) => {
    try {
      setIsUploading(true);
      const supabase = getSupabase();

      console.log('[upload] Checking file at URI:', uri);

      // Read the file
      const info = await FileSystem.getInfoAsync(uri);
      console.log('[upload] File info:', info);

      if (!info.exists) {
        throw new Error(`Recording file not found at: ${uri}`);
      }

      if (info.size === 0) {
        throw new Error('Recording file is empty');
      }

      console.log('[upload] File exists, size:', info.size);

      // Verify session exists and user has access before uploading
      const { data: sessionCheck, error: sessionError } = await supabase
        .from('sessions')
        .select('id, organization_id, status')
        .eq('id', sessionId)
        .single();

      if (sessionError || !sessionCheck) {
        throw new Error(`Session not found or no access: ${sessionError?.message}`);
      }

      console.log('[upload] Session verified:', sessionCheck);
      const { data: sessionData } = await supabase.auth.getSession();

      console.log('[upload] Original file size:', info.size);
      console.log('[upload] Original file URI:', uri);

      // Get signed URL for direct upload (bypasses Vercel size limits)
      const signRes = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/signed-upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(sessionData?.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {}),
        },
        body: JSON.stringify({ mimeType: 'audio/mp4' })
      });

      if (!signRes.ok) {
        const signError = await signRes.json().catch(() => ({}));
        throw new Error(`Sign failed ${signRes.status}: ${signError.message || 'Unknown error'}`);
      }

      const { token, path } = await signRes.json();
      if (!token || !path) {
        throw new Error('Sign missing token or path');
      }

      console.log('[upload] Got signed URL, uploading to path:', path);

      // Start progress simulation
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev < 90) return prev + Math.random() * 10;
          return prev;
        });
      }, 300);

      try {
        console.log('[upload] Attempting signed URL upload with Expo FileSystem...');

        // Use Expo FileSystem.uploadAsync for proper file handling
        const uploadUrl = `${supabase.storage.from('copilot.sh').getPublicUrl('dummy').data.publicUrl.replace('/dummy', '')}/${path}?token=${token}`;

        console.log('[upload] Upload URL:', uploadUrl);
        console.log('[upload] File URI:', uri);

        const uploadResponse = await FileSystem.uploadAsync(uploadUrl, uri, {
          httpMethod: 'PUT',
          headers: {
            'Content-Type': 'audio/mp4',
          },
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        });

        console.log('[upload] Expo FileSystem upload response:', uploadResponse);

        if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
          throw new Error(`Upload failed with status ${uploadResponse.status}: ${uploadResponse.body || 'Unknown error'}`);
        }

        console.log('[upload] Successfully uploaded via Expo FileSystem');

        clearInterval(progressInterval);
        setUploadProgress(100);

        // Create debug download URL
        try {
          const supabase = getSupabase();
          const { data: downloadData, error: urlError } = await supabase.storage
            .from('copilot.sh')
            .createSignedUrl(path, 3600);

          if (urlError) {
            console.log('[upload] Error creating debug URL:', urlError);
          } else if (downloadData?.signedUrl) {
            console.log('[upload] ✅ Download URL for testing:', downloadData.signedUrl);
            console.log('[upload] 🎵 Test with: ffplay "' + downloadData.signedUrl + '"');
          }
        } catch (debugErr) {
          console.log('[upload] Exception generating debug URL:', debugErr);
        }
      } catch (err) {
        clearInterval(progressInterval);
        throw err;
      }
      return true;
    } catch (error: any) {
      console.error('[upload] Upload failed:', error);
      Alert.alert('Upload Failed', error?.message || 'Failed to upload recording');
      return false;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [apiBaseUrl]);

  // Simple recording approach - record one continuous file

  const startRecording = useCallback(async () => {
    if (isRecording) return;

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

      // Get organization ID for storage path
      const { data: orgs, error: orgErr } = await supabase.rpc('my_organizations');
      const orgId = (!orgErr && Array.isArray(orgs) && orgs.length > 0) ? String(orgs[0].org_id) : null;
      orgIdRef.current = orgId;

      if (!orgId) {
        throw new Error('No organization found');
      }

      // Prepare and start single continuous recording
      // Let expo-audio choose the file location, then get it from the stop result
      console.log('[rec] Starting continuous recording...');
      await audioRecorderRef.current?.prepareToRecordAsync(recordingOptions);
      const recordingResult = await audioRecorderRef.current?.record();

      console.log('[rec] Recording started, result:', recordingResult);

      setIsRecording(true);
      setIsStarting(false);

      // Start duration timer
      recordingStartTimeRef.current = Date.now();
      setRecordingDuration(0);
      durationTimerRef.current = setInterval(() => {
        if (recordingStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
          setRecordingDuration(elapsed);
        }
      }, 1000) as any;

      console.log('[rec] Started continuous recording successfully');
    } catch (e: any) {
      console.log('[rec] start error', e?.message);
      setIsStarting(false);
      Alert.alert('Error', e?.message || 'Failed to start recorder');
    }
  }, [isRecording, apiBaseUrl, title, customPrompt, recordingOptions, resetForNewSession]);

  // Auto-finalize session after upload
  const autoFinalizeSession = useCallback(async () => {
    const sid = lastSessionIdRef.current;
    if (!sid) return;

    try {
      setIsFinalizing(true);
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';

      // Update title/prompt if provided
      if ((title && title.trim()) || (customPrompt && customPrompt.trim())) {
        await fetch(`${apiBaseUrl}/api/sessions/${sid}`, {
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

      console.log('[rec] Auto-finalization started for session:', sid);

      // Show completion message
      setTimeout(() => {
        setIsFinalizing(false);
        setJustSaved(true);

        // Reset for next recording
        setTimeout(() => {
          setJustSaved(false);
          sessionIdRef.current = null;
          resetForNewSession();
        }, 2000);
      }, 500);
    } catch (e: any) {
      console.log('[rec] Auto-finalize failed:', e?.message);
      setIsFinalizing(false);
    }
  }, [apiBaseUrl, title, customPrompt, resetForNewSession]);

  // Stop recording and upload to Supabase
  const stopRecording = useCallback(async () => {
    if (!isRecording) return;

    setIsStopping(true);

    try {
      // Stop the recording
      console.log('[rec] Stopping recording...');
      const stopResult = await audioRecorderRef.current?.stop();
      console.log('[rec] stop result', stopResult);

      // Get the actual recording URI from the recorder
      const recordingUri = audioRecorderRef.current?.uri || stopResult?.url;

      // Stop duration timer
      if (durationTimerRef.current) {
        try { clearInterval(durationTimerRef.current as any); } catch { }
        durationTimerRef.current = null;
      }
      recordingStartTimeRef.current = null;
      setIsRecording(false);

      if (!recordingUri) {
        throw new Error('No recording file found');
      }

      console.log('[rec] Recording stopped, uploading to Supabase...', recordingUri);
      const sessionId = sessionIdRef.current;
      const orgId = orgIdRef.current;

      if (!sessionId || !orgId) {
        throw new Error('Missing session or organization ID');
      }

      // Upload directly to Supabase
      const uploadSuccess = await uploadToSupabase(recordingUri, sessionId, orgId);

      if (uploadSuccess) {
        // Mark session as stopped on the server
        try {
          const supabase = getSupabase();
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData?.session?.access_token || '';
          await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/stop`, {
            method: 'POST',
            headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          });
          lastSessionIdRef.current = sessionId;
        } catch (e) {
          console.warn('[rec] Failed to mark session as stopped:', e);
        }

        // Auto-finalize the session
        await autoFinalizeSession();
      }
    } catch (e: any) {
      console.error('[rec] Stop recording failed:', e?.message);
      Alert.alert('Error', e?.message || 'Failed to stop recording');
    } finally {
      setIsStopping(false);
    }
  }, [isRecording, apiBaseUrl, uploadToSupabase, autoFinalizeSession]);

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
            <View className={`absolute h-32 w-32 rounded-full border-2 ${isRecording ? 'border-red-200 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`} pointerEvents="none" />



            {/* Main button with press feedback */}
            <Pressable
              onPress={isRecording ? () => {
                // Stop recording
                stopRecording();
              } : () => {
                // Show immediate feedback, then start recording
                setIsStarting(true);
                startRecording();
              }}
              disabled={isStarting || isStopping || isFinalizing || isUploading}
              className={`h-24 w-24 rounded-full items-center justify-center border-4 ${isRecording && !isStopping
                ? 'bg-red-500 border-red-300'
                : (isStarting || isStopping || isFinalizing || isUploading)
                  ? 'bg-emerald-500 border-emerald-300'
                  : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'
                }`}
              accessibilityLabel={
                isRecording && !isStopping ? 'Stop recording'
                  : isStopping ? 'Stopping...'
                    : isUploading ? 'Uploading...'
                      : isFinalizing ? 'Processing...'
                        : isStarting ? 'Starting...'
                          : 'Start recording'
              }
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={({ pressed }) => [
                {
                  zIndex: 1,
                  transform: [{ scale: pressed && !isStarting && !isStopping && !isFinalizing && !isUploading ? 0.95 : 1 }],
                  opacity: (isStarting || isStopping || isFinalizing || isUploading) ? 0.7 : (pressed ? 0.8 : 1),
                },
              ]}
              android_ripple={{
                color: isRecording ? '#ffffff40' : '#10b98140',
                radius: 48,
                borderless: false
              }}
            >
              {isRecording && !isStopping ? (
                <Ionicons name="stop" size={32} color="#ffffff" />
              ) : (isStarting || isStopping || isFinalizing || isUploading) ? (
                <ActivityIndicator size="large" color="#ffffff" />
              ) : (
                <Ionicons name="mic" size={32} color="#374151" />
              )}
            </Pressable>
          </View>

          {/* Simplified status indicator */}
          <View className="mt-6 items-center min-h-[44px] justify-center">
            {isRecording ? (
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
            ) : isUploading ? (
              <View className="items-center bg-blue-50 dark:bg-blue-900/20 px-4 py-3 rounded-xl">
                <View className="flex-row items-center mb-2">
                  <ActivityIndicator size="small" color="#3b82f6" />
                  <ThemedText className="text-blue-700 dark:text-blue-400 font-medium ml-2">
                    Uploading{uploadProgress > 0 ? ` ${uploadProgress}%` : '…'}
                  </ThemedText>
                </View>
                {uploadProgress > 0 && (
                  <View className="w-full h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                    <View
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </View>
                )}
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
        {(isRecording || isFinalizing || justSaved) && (
          <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-5 border-2 border-gray-100 dark:border-gray-700/50">
            <ThemedText className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              {isRecording ? 'Recording Session' : (isFinalizing ? 'Processing Session' : 'Session Complete')}
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




      </View>
    </ScrollView>
  );
}

// styles removed; using Tailwind utility classes


