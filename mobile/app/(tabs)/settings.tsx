import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, TextInput, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Button } from '@/components/ui/button';
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
        } catch {
          setIsAuthed(false);
        }
      } finally {
        setAuthChecked(true);
      }
    })();
    // Subscribe to Supabase auth state changes
    const supabase = getSupabase();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(!!session);
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
        } catch {
          setIsAuthed(false);
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
    <ParallaxScrollView headerBackgroundColor={{ light: '#fff', dark: '#000' }} headerImage={<ThemedView />}>
      <ThemedView style={styles.container}>
        <ThemedText type="title">Settings</ThemedText>

        <View style={styles.field}>
          <ThemedText type="defaultSemiBold">API Base URL</ThemedText>
          <TextInput
            style={[styles.input, { borderColor: inputColors.borderColor, backgroundColor: inputColors.backgroundColor, color: inputColors.textColor }]}
            placeholder="https://your-deploy.example.com"
            placeholderTextColor={inputColors.placeholder}
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        {/* Device Key removed for mobile app - users authenticate via Supabase */}
        <View style={styles.field}>
          <ThemedText type="defaultSemiBold">Supabase URL</ThemedText>
          <TextInput
            style={[styles.input, { borderColor: inputColors.borderColor, backgroundColor: inputColors.backgroundColor, color: inputColors.textColor }]}
            placeholder="https://xxx.supabase.co"
            placeholderTextColor={inputColors.placeholder}
            value={sbUrl}
            onChangeText={setSbUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.field}>
          <ThemedText type="defaultSemiBold">Supabase Anon Key</ThemedText>
          <TextInput
            style={[styles.input, { borderColor: inputColors.borderColor, backgroundColor: inputColors.backgroundColor, color: inputColors.textColor }]}
            placeholder="paste anon key"
            placeholderTextColor={inputColors.placeholder}
            value={sbAnon}
            onChangeText={setSbAnon}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Button onPress={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          onPress={signOut}
          style={{ backgroundColor: '#dc2626', width: '100%', marginTop: 8 }}
          textColor="#ffffff"
        >
          Sign out
        </Button>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 8,
    padding: 10,
    color: '#111111',
  },
});


