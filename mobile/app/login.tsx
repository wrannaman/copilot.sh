import React, { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { Audio } from 'expo-av'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'

import { getSupabase } from '@/lib/supabase'
import { Ionicons, AntDesign } from '@expo/vector-icons'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useColorScheme } from '@/hooks/useColorScheme'

WebBrowser.maybeCompleteAuthSession()

export default function LoginScreen() {
  const supabase = getSupabase()
  const { height } = useWindowDimensions()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const colorScheme = useColorScheme()
  const specialEmail = 'apple@copilot.sh'
  const isReviewEmail = email.trim().toLowerCase() === specialEmail
  const isSmallScreen = height < 700

  // Local-only trial recording state (one clip, max 30s)
  const [recording, setRecording] = useState<Audio.Recording | null>(null)
  const [recordingUri, setRecordingUri] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const elapsedIntervalRef = useRef<any>(null)
  const MAX_MS = 30_000
  const [isPlaying, setIsPlaying] = useState(false)
  const playbackSoundRef = useRef<Audio.Sound | null>(null)

  useEffect(() => {
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        console.log('[apple] available?', available)
        setAppleAvailable(available)
      })
      .catch(() => {
        console.log('[apple] availability check failed')
        setAppleAvailable(false)
      })
  }, [])

  // Redirect to tabs when already signed in
  useEffect(() => {
    let isMounted = true
      ; (async () => {
        const { data } = await supabase.auth.getSession()
        console.log('[auth] initial session present?', !!data?.session)
        if (isMounted && data?.session) {
          handleSignedIn()
        }
      })()
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth] onAuthStateChange', event, 'hasSession?', !!session)
      if (session) handleSignedIn()
    })
    return () => {
      isMounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const isAuthUrl = (u?: string | null) => {
    if (!u) return false
    return u.startsWith('copilotsh://auth')
  }

  function formatTime(ms: number) {
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  async function startTrialRecording() {
    try {
      if (isRecording || recordingUri) return
      const perm = await Audio.requestPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Permission required', 'Microphone permission is needed to record.')
        return
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY)
      setRecording(recording)
      setIsRecording(true)
      setElapsedMs(0)
      elapsedIntervalRef.current = setInterval(() => {
        setElapsedMs((prev) => {
          const next = prev + 200
          if (next >= 30000) {
            stopTrialRecording()
          }
          return next
        })
      }, 200)
    } catch (e: any) {
      console.log('[trial] start error', e?.message)
      Alert.alert('Error', e?.message || 'Failed to start recording')
    }
  }

  async function stopTrialRecording() {
    try {
      if (!recording) return
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current)
        elapsedIntervalRef.current = null
      }
      await recording.stopAndUnloadAsync()
      setIsRecording(false)
      const uri = recording.getURI()
      setRecording(null)
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false })
      if (uri) setRecordingUri(uri)
    } catch (e: any) {
      console.log('[trial] stop error', e?.message)
      Alert.alert('Error', e?.message || 'Failed to stop recording')
    }
  }

  async function stopPlayback() {
    try {
      if (playbackSoundRef.current) {
        try { await playbackSoundRef.current.stopAsync() } catch {}
        try { await playbackSoundRef.current.unloadAsync() } catch {}
        playbackSoundRef.current = null
      }
    } finally {
      setIsPlaying(false)
    }
  }

  async function togglePlayTrialRecording() {
    try {
      if (!recordingUri) return
      if (isPlaying) {
        await stopPlayback()
        return
      }
      // Ensure any previous sound is cleaned up
      await stopPlayback()
      const { sound } = await Audio.Sound.createAsync({ uri: recordingUri })
      playbackSoundRef.current = sound
      setIsPlaying(true)
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status && status.isLoaded && status.didJustFinish) {
          stopPlayback()
        }
      })
      await sound.playAsync()
    } catch (e: any) {
      console.log('[trial] play error', e?.message)
      Alert.alert('Error', e?.message || 'Failed to play recording')
      setIsPlaying(false)
    }
  }

  async function deleteTrialRecording() {
    await stopPlayback()
    setRecordingUri(null)
    setElapsedMs(0)
  }

  function handleSignedIn() {
    // Stop any playback and clear trial
    stopPlayback().catch(() => {})
    setRecording(null)
    setRecordingUri(null)
    setIsRecording(false)
    setElapsedMs(0)
    router.replace('/(tabs)/record')
  }

  // Handle deep link to complete OAuth (and magic link) by exchanging code for session
  useEffect(() => {
    // Mark checked after initial onAuthStateChange runs or immediately if no session
    supabase.auth.getSession().then(({ data }) => setAuthChecked(true)).catch(() => setAuthChecked(true))
    const handleUrl = async (url?: string | null) => {
      if (!isAuthUrl(url)) return
      console.log('[linking] received auth url', url)
      const u = new URL(url as string)
      const accessToken = u.hash?.includes('access_token') ? new URLSearchParams(u.hash.replace(/^#/, '')).get('access_token') : null
      const refreshToken = u.hash?.includes('refresh_token') ? new URLSearchParams(u.hash.replace(/^#/, '')).get('refresh_token') : null
      const code = u.searchParams.get('code')
      try {
        if (accessToken && refreshToken) {
          // Fallback for implicit/hash responses
          const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          console.log('[linking] setSession result', { hasSession: !!data?.session, error: error?.message })
          if (!error && data?.session) return router.replace('/(tabs)/record')
        }
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code)
          console.log('[linking] exchange result', { hasSession: !!data?.session, error: error?.message })
          if (!error && data?.session) {
            return router.replace('/(tabs)/record')
          }
        }
        console.log('[linking] no code or tokens present')
      } catch (e: any) {
        console.log('[linking] exchange failed', e?.message)
      }
    }
    Linking.getInitialURL().then((u) => {
      console.log('[linking] initial URL', u)
      if (isAuthUrl(u)) handleUrl(u)
    }).catch((e) => console.log('[linking] getInitialURL error', e?.message))
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (isAuthUrl(url)) handleUrl(url)
    })
    return () => {
      // @ts-ignore - RN SDKs differ
      sub?.remove?.()
    }
  }, [])

  async function signInWithMagicLink() {
    if (!email.trim()) return
    setLoading(true)
    try {
      console.log('[magic] sending link to', email.trim())
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: 'copilotsh://auth' } })
      if (error) throw error
      console.log('[magic] link sent')
      Alert.alert('Check your email', 'Magic link sent')
    } catch (e: any) {
      console.log('[magic] error', e?.message)
      Alert.alert('Error', e?.message || 'Failed to send link')
    } finally {
      setLoading(false)
    }
  }

  async function signInWithPassword() {
    if (!email.trim() || !password) return
    setLoading(true)
    try {
      console.log('[password] signing in with email/password for', email.trim())
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      console.log('[password] result', { hasSession: !!data?.session, error: error?.message })
      if (error) throw error
      if (data?.session) return router.replace('/(tabs)/record')
    } catch (e: any) {
      console.log('[password] error', e?.message)
      Alert.alert('Error', e?.message || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  async function signInWithProvider(provider: 'google' | 'apple') {
    setLoading(true)
    try {
      console.log('[oauth] start', provider)
      const redirectTo = 'copilotsh://auth'
      console.log('[oauth] redirectTo', redirectTo)
      const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
      if (error) throw error
      console.log('[oauth] got auth url?', !!data?.url)
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
        console.log('[oauth] browser result', result)
        if (result.type === 'success' && result.url && isAuthUrl(result.url)) {
          const code = new URL(result.url).searchParams.get('code')
          if (code) {
            const { data: exData, error: exErr } = await supabase.auth.exchangeCodeForSession(code)
            console.log('[oauth] exchange result', { hasSession: !!exData?.session, error: exErr?.message })
            if (!exErr && exData?.session) {
              return router.replace('/(tabs)/record')
            }
          } else {
            console.log('[oauth] no code param in result')
          }
        }
      }
    } catch (e: any) {
      console.log('[oauth] error', e?.message)
      Alert.alert('Error', e?.message || 'OAuth failed')
    } finally {
      setLoading(false)
    }
  }

  if (!authChecked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  return (
    <ScrollView className="flex-1 bg-slate-50 dark:bg-gray-900">
      <View className="flex-1 justify-center px-8 py-12 min-h-screen">
        {/* Logo Section */}
        <View className="items-center mb-10" style={{ marginBottom: isSmallScreen ? 16 : 16 }}>
          <View className="bg-white dark:bg-gray-800 rounded-3xl p-6  mb-8">
            <Image
              source={colorScheme === 'dark' ? require('@/assets/images/icon-white.png') : require('@/assets/images/icon.png')}
              className="w-20 h-20"
              style={{ height: 75, width: 75 }}
              contentFit="contain"
            />
          </View>
          <Text className="text-5xl font-bold text-gray-900 dark:text-white text-center mb-3">
            copilot.sh
          </Text>
          <Text className="text-lg text-gray-600 dark:text-gray-400 text-center font-medium">
            The simplest way to record and transcribe your meetings
          </Text>
        </View>

        {/* Local trial recording (no account needed) */}
        <View className="mt-0 bg-white dark:bg-gray-800/50 rounded-2xl p-6  backdrop-blur-sm">
          <View className="gap-3">
            <Text className="text-gray-800 dark:text-gray-200 font-semibold text-base">
              Try recording without an account
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-sm">
              Record one 30s clip locally. Not uploaded. Create an account to save and transcribe.
            </Text>

            {!recordingUri ? (
              <View className="gap-3">
                {!isRecording ? (
                  <Pressable
                    onPress={startTrialRecording}
                    className="w-full p-4 "
                    style={{ borderRadius: 16, backgroundColor: '#0EA5E9' }}
                  >
                    <Text className="text-white text-center font-semibold text-base">Record 30s test</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={stopTrialRecording}
                    className="w-full p-4 "
                    style={{ borderRadius: 16, backgroundColor: '#EF4444' }}
                  >
                    <Text className="text-white text-center font-semibold text-base">Stop ({formatTime(elapsedMs)} / 00:30)</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View className="gap-3">
                <Pressable
                  onPress={togglePlayTrialRecording}
                  className="w-full p-4 "
                  style={{ borderRadius: 16, backgroundColor: isPlaying ? '#EF4444' : '#10B981' }}
                >
                  <Text className="text-white text-center font-semibold text-base">{isPlaying ? 'Stop playback' : 'Play test clip'}</Text>
                </Pressable>
                <Pressable
                  onPress={deleteTrialRecording}
                  className="w-full p-3 "
                  style={{ borderRadius: 16, backgroundColor: '#374151' }}
                >
                  <Text className="text-white text-center font-medium text-base">Delete test clip</Text>
                </Pressable>
                <Text className="text-gray-500 dark:text-gray-400 text-xs text-center">
                  To save and transcribe recordings, create a free account above.
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Sign In Section */}
        <View className="items-center mb-8">

          <Text className="text-gray-500 dark:text-gray-400 text-center mt-4">
            Sign in for more features
          </Text>
        </View>

        {/* Form */}
        <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-6  backdrop-blur-sm">
          <View className="gap-6">
            <View className="gap-3">
              <Text className="text-gray-700 dark:text-gray-300 font-semibold text-base">
                Email (magic link)
              </Text>
              <TextInput
                className="border border-gray-200 dark:border-gray-600 p-4 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-base "
                style={{ borderRadius: 16 }}
                placeholder="you@company.com"
                placeholderTextColor="#999999"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            {isReviewEmail ? (
              <View className="gap-3">
                <Text className="text-gray-700 dark:text-gray-300 font-semibold text-base">
                  Password
                </Text>
                <TextInput
                  className="border border-gray-200 dark:border-gray-600 p-4 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-base "
                  style={{ borderRadius: 16 }}
                  placeholder="Enter password"
                  placeholderTextColor="#999999"
                  autoCapitalize="none"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
                <Pressable
                  onPress={signInWithPassword}
                  disabled={loading || !password}
                  className="w-full p-4 "
                  style={{
                    borderRadius: 16,
                    backgroundColor: loading || !password ? '#9CA3AF' : '#2563EB'
                  }}
                >
                  <Text className="text-white text-center font-semibold text-base">
                    {loading ? 'Signing in…' : 'Sign in'}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={signInWithMagicLink}
                disabled={loading || !email.trim()}
                className="w-full p-4 "
                style={{
                  borderRadius: 16,
                  backgroundColor: loading || !email.trim() ? '#9CA3AF' : '#2563EB'
                }}
              >
                <Text className="text-white text-center font-semibold text-base">
                  {loading ? 'Sending…' : 'Send magic link'}
                </Text>
              </Pressable>
            )}

            <View className="items-center my-6">
              <View className="flex-row items-center w-full">
                <View className="flex-1 h-px bg-gray-200 dark:bg-gray-600" />
                <Text className="text-gray-500 dark:text-gray-400 text-center font-medium px-4">
                  Or continue with
                </Text>
                <View className="flex-1 h-px bg-gray-200 dark:bg-gray-600" />
              </View>
            </View>

            <View className="gap-4">
              <Pressable
                onPress={() => signInWithProvider('google')}
                disabled={loading}
                className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 p-4 w-full "
                style={{ borderRadius: 16 }}
              >
                <View className="flex-row items-center justify-center">
                  <AntDesign name="google" size={22} color="#4285F4" style={{ marginRight: 12 }} />
                  <Text className="text-gray-900 dark:text-white font-semibold text-base">
                    Continue with Google
                  </Text>
                </View>
              </Pressable>

              {appleAvailable ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={16}
                  style={{ width: '100%', height: 52 }}
                  onPress={() => signInWithProvider('apple')}
                />
              ) : (
                <Pressable
                  onPress={() => signInWithProvider('apple')}
                  disabled={loading}
                  className="bg-black dark:bg-gray-900 p-4 w-full "
                  style={{ borderRadius: 16 }}
                >
                  <View className="flex-row items-center justify-center">
                    <Ionicons name="logo-apple" size={22} color="#ffffff" style={{ marginRight: 12 }} />
                    <Text className="text-white font-semibold text-base">
                      Sign in with Apple
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
