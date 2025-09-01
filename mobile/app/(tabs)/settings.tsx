import React, { useEffect, useMemo, useState } from 'react';
import { Alert, TextInput, View, ActivityIndicator, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

import Constants from 'expo-constants';
import { getSupabase, setSupabaseConfig } from '@/lib/supabase';
import { Redirect, router } from 'expo-router';
import { useColorScheme } from '@/hooks/useColorScheme';

const KEY_API_BASE = 'copilot.apiBaseUrl';
const KEY_SB_URL = 'copilot.supabaseUrl';
const KEY_SB_ANON = 'copilot.supabaseAnon';

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const inputColors = useMemo(() => ({
    borderColor: isDark ? '#374151' : '#dddddd',
    backgroundColor: isDark ? '#111827' : '#ffffff',
    textColor: isDark ? '#f9fafb' : '#111111',
    placeholder: isDark ? '#9CA3AF' : '#999999',
  }), [isDark]);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  const [sbAnon, setSbAnon] = useState('');
  const [initialApiBaseUrl, setInitialApiBaseUrl] = useState('');
  const [initialSbUrl, setInitialSbUrl] = useState('');
  const [initialSbAnon, setInitialSbAnon] = useState('');
  const [saving, setSaving] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [a, su, sa] = await Promise.all([
          AsyncStorage.getItem(KEY_API_BASE),
          AsyncStorage.getItem(KEY_SB_URL),
          AsyncStorage.getItem(KEY_SB_ANON),
        ]);
        const extras = (Constants?.expoConfig?.extra || {}) as any;
        const resolvedApi = a || extras.apiBaseUrl || '';
        const resolvedSbUrl = su || extras.supabaseUrl || '';
        const resolvedSbAnon = sa || extras.supabaseAnon || '';
        setApiBaseUrl(resolvedApi);
        setSbUrl(resolvedSbUrl);
        setSbAnon(resolvedSbAnon);
        setInitialApiBaseUrl(resolvedApi);
        setInitialSbUrl(resolvedSbUrl);
        setInitialSbAnon(resolvedSbAnon);
        // Check Supabase session
        try {
          const supabase = getSupabase();
          const { data } = await supabase.auth.getSession();
          setIsAuthed(!!data?.session);
          setUserEmail(data?.session?.user?.email || '');
        } catch {
          setIsAuthed(false);
          setUserEmail('');
        }
      } finally {
        setAuthChecked(true);
      }
    })();
    // Subscribe to Supabase auth state changes
    const supabase = getSupabase();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
      setUserEmail(session?.user?.email || '');
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const nextApi = apiBaseUrl.trim();
      const nextSbUrl = sbUrl.trim();
      const nextSbAnon = sbAnon.trim();
      const apiChanged = nextApi !== initialApiBaseUrl;
      const supabaseChanged = nextSbUrl !== initialSbUrl || nextSbAnon !== initialSbAnon;

      await Promise.all([
        AsyncStorage.setItem(KEY_API_BASE, nextApi),
        AsyncStorage.setItem(KEY_SB_URL, nextSbUrl),
        AsyncStorage.setItem(KEY_SB_ANON, nextSbAnon),
      ]);
      (globalThis as any).__COPILOT_API_BASE_URL__ = nextApi;

      if (apiChanged || supabaseChanged) {
        try {
          const supabase = getSupabase();
          await supabase.auth.signOut();
        } catch { }
        // Best-effort: purge any Supabase auth/session keys from AsyncStorage
        try {
          const keys = await AsyncStorage.getAllKeys();
          const toRemove = keys.filter((k) => /^(sb-|@supabase|supabase)/i.test(k) || /supabase.*(auth|token|session)/i.test(k) || /(auth|token|session).*supabase/i.test(k));
          if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
        } catch { }
        if (supabaseChanged) {
          await setSupabaseConfig(nextSbUrl, nextSbAnon);
        }
        setIsAuthed(false);
        setUserEmail('');
        Alert.alert('Saved', 'Settings updated. Please sign in again.');
        router.replace('/login');
        return;
      } else {
        // No breaking changes; refresh config and session status
        await setSupabaseConfig(nextSbUrl, nextSbAnon);
        try {
          const supabase = getSupabase();
          const { data } = await supabase.auth.getSession();
          setIsAuthed(!!data?.session);
          setUserEmail(data?.session?.user?.email || '');
        } catch {
          setIsAuthed(false);
          setUserEmail('');
        }
        Alert.alert('Saved', 'Settings updated');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      const supabase = getSupabase();
      await supabase.auth.signOut();
    } catch { }
    setIsAuthed(false);
    setUserEmail('');
    router.replace('/login');
  }

  if (!authChecked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!isAuthed) return <Redirect href="/login" />;

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#f8fafc', dark: '#0f172a' }}
      headerImage={
        <View className="flex-1 bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 dark:from-gray-900 dark:via-orange-900 dark:to-red-900" />
      }
    >
      <ThemedView className="gap-6">
        <View className="items-center">
          <ThemedText type="title" className="text-gray-900 dark:text-white">Settings</ThemedText>
          <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-1">
            Configure your app settings
          </ThemedText>
        </View>

        {userEmail ? (
          <View className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-800/50">
            <View className="items-center">
              <ThemedText className="text-blue-700 dark:text-blue-300 font-medium">
                Logged in as
              </ThemedText>
              <ThemedText className="text-blue-900 dark:text-blue-100 font-semibold mt-1">
                {userEmail}
              </ThemedText>
            </View>
          </View>
        ) : null}

        <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700/50">
          <ThemedText className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Server Configuration</ThemedText>

          <View className="gap-4">
            <View className="gap-2">
              <ThemedText className="text-gray-700 dark:text-gray-300 font-medium">API Base URL</ThemedText>
              <TextInput
                className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50"
                placeholder="https://your-deploy.example.com"
                placeholderTextColor={inputColors.placeholder}
                value={apiBaseUrl}
                onChangeText={setApiBaseUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View className="gap-2">
              <ThemedText className="text-gray-700 dark:text-gray-300 font-medium">Supabase URL</ThemedText>
              <TextInput
                className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50"
                placeholder="https://xxx.supabase.co"
                placeholderTextColor={inputColors.placeholder}
                value={sbUrl}
                onChangeText={setSbUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View className="gap-2">
              <ThemedText className="text-gray-700 dark:text-gray-300 font-medium">Supabase Anon Key</ThemedText>
              <TextInput
                className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50"
                placeholder="paste anon key"
                placeholderTextColor={inputColors.placeholder}
                value={sbAnon}
                onChangeText={setSbAnon}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
            </View>
          </View>
        </View>

        <View className="gap-3">
          <Pressable
            onPress={save}
            disabled={saving}
            className={`w-full px-6 py-4 rounded-xl items-center justify-center shadow-md ${saving
              ? 'bg-gray-300 dark:bg-gray-600'
              : 'bg-gradient-to-r from-green-600 to-green-700 dark:from-green-500 dark:to-green-600'
              }`}
          >
            <View className="flex-row items-center">
              {saving && (
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
              )}
              <ThemedText className="text-white font-semibold text-base">
                {saving ? 'Saving…' : 'Save Settings'}
              </ThemedText>
            </View>
          </Pressable>

          <Pressable
            onPress={signOut}
            className="w-full px-6 py-4 rounded-xl items-center justify-center shadow-md bg-gradient-to-r from-red-500 to-red-600"
          >
            <ThemedText className="text-white font-semibold text-base">
              Sign Out
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    </ParallaxScrollView>
  );
}




