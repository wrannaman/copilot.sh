import React, { useEffect, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View, ScrollView, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'

import { getSupabase } from '@/lib/supabase'
import { Ionicons, AntDesign } from '@expo/vector-icons'
import * as AppleAuthentication from 'expo-apple-authentication'

WebBrowser.maybeCompleteAuthSession()

export default function LoginScreen() {
  const supabase = getSupabase()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const specialEmail = 'apple@copilot.sh'
  const isReviewEmail = email.trim().toLowerCase() === specialEmail

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
          router.replace('/(tabs)/record')
        }
      })()
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth] onAuthStateChange', event, 'hasSession?', !!session)
      if (session) router.replace('/(tabs)/record')
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
        <View className="items-center mb-16">
          <View className="bg-white dark:bg-gray-800 rounded-3xl p-6  mb-8">
            <Image
              source={require('@/assets/images/icon.png')}
              className="w-20 h-20"
              style={{ height: 80, width: 80 }}
            />
          </View>
          <Text className="text-5xl font-bold text-gray-900 dark:text-white text-center mb-3">
            copilot.sh
          </Text>
          <Text className="text-lg text-gray-600 dark:text-gray-400 text-center font-medium">
            Always-on meeting recorder
          </Text>
        </View>

        {/* Sign In Section */}
        <View className="items-center mb-8">
          <Text className="text-2xl font-semibold text-gray-800 dark:text-gray-200 text-center mb-2">
            Welcome back
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            Sign in to continue recording
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
                  style={{ width: '100%', height: 52, shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}
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
