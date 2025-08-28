import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Button } from '@/components/ui/button';
import Constants from 'expo-constants';
import { getSupabase, setSupabaseConfig } from '@/lib/supabase';
import { Redirect, router } from 'expo-router';

const KEY_API_BASE = 'copilot.apiBaseUrl';
const KEY_SB_URL = 'copilot.supabaseUrl';
const KEY_SB_ANON = 'copilot.supabaseAnon';

export default function SettingsScreen() {
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [sbUrl, setSbUrl] = useState('');
  const [sbAnon, setSbAnon] = useState('');
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
        if (a) setApiBaseUrl(a);
        if (su) setSbUrl(su);
        if (sa) setSbAnon(sa);
        const extras = (Constants?.expoConfig?.extra || {}) as any;
        if (!a && extras.apiBaseUrl) setApiBaseUrl(extras.apiBaseUrl);
        if (!su && extras.supabaseUrl) setSbUrl(extras.supabaseUrl);
        if (!sa && extras.supabaseAnon) setSbAnon(extras.supabaseAnon);
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
      await Promise.all([
        AsyncStorage.setItem(KEY_API_BASE, apiBaseUrl.trim()),
        AsyncStorage.setItem(KEY_SB_URL, sbUrl.trim()),
        AsyncStorage.setItem(KEY_SB_ANON, sbAnon.trim()),
      ]);
      // Expose to global for simple access in MVP
      (globalThis as any).__COPILOT_API_BASE_URL__ = apiBaseUrl.trim();
      await setSupabaseConfig(sbUrl.trim(), sbAnon.trim());
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        setIsAuthed(!!data?.session);
      } catch {
        setIsAuthed(false);
      }
      Alert.alert('Saved', 'Settings updated');
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
            style={styles.input}
            placeholder="https://your-deploy.example.com"
            placeholderTextColor="#999999"
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
            style={styles.input}
            placeholder="https://xxx.supabase.co"
            placeholderTextColor="#999999"
            value={sbUrl}
            onChangeText={setSbUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.field}>
          <ThemedText type="defaultSemiBold">Supabase Anon Key</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="paste anon key"
            placeholderTextColor="#999999"
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


