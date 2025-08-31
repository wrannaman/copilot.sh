import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, TextInput, Pressable, Text, FlatList, ActivityIndicator, Alert } from 'react-native';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { getSupabase } from '@/lib/supabase';
import ParallaxScrollView from '@/components/ParallaxScrollView';

type SearchResult = {
  session_id: string;
  session_title?: string | null;
  created_at?: string | null;
  duration_seconds?: number | null;
  start_time_seconds?: number | null;
  content: string;
  similarity?: number | null;
  calendar_event?: { title?: string | null } | null;
};

function formatDuration(totalSeconds?: number | null) {
  if (!totalSeconds && totalSeconds !== 0) return '';
  const minutes = Math.floor((totalSeconds as number) / 60);
  const seconds = Math.floor((totalSeconds as number) % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        // Emulate web's ensureOrganization: first try RPC, fallback to cookie-like memory is not available on RN
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase.rpc('my_organizations');
        if (!error && Array.isArray(data) && data.length > 0) {
          setOrganizationId(String(data[0].org_id));
        }
      } catch { }
    })();
  }, []);

  const apiBaseUrl = useMemo(() => (globalThis as any).__COPILOT_API_BASE_URL__ || 'http://localhost:3000', []);

  const onSearch = useCallback(async () => {
    if (!query.trim() || !organizationId) return;
    try {
      setLoading(true);
      setHasSearched(true);
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';
      const res = await fetch(`${apiBaseUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          query: query.trim(),
          organizationId,
          filters: { dateRange: 'all', sessionType: 'all' },
          limit: 20,
        }),
      });
      if (!res.ok) throw new Error('Search failed');
      const json = await res.json().catch(() => ({} as any));
      setResults(Array.isArray(json?.results) ? json.results : []);
    } catch (e: any) {
      setResults([]);
      Alert.alert('Search failed', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, organizationId, query]);

  const onCopy = useCallback(async (text: string) => {
    try {
      const Clipboard: any = await import('expo-clipboard');
      if (Clipboard && typeof Clipboard.setStringAsync === 'function') {
        await Clipboard.setStringAsync(text);
        Alert.alert('Copied', 'Text copied to clipboard.');
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch (e) {
      Alert.alert('Copy unavailable', 'Clipboard is not available in this build.');
    }
  }, []);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={<ThemedView />}
    >
      <ThemedView className="gap-3">
        <ThemedText type="title">Search</ThemedText>
        <View className="flex-row items-center gap-2 mt-3">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations, topics, commitments..."
            className="flex-1 border border-gray-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-foreground"
          />
          <Pressable
            onPress={onSearch}
            disabled={!query.trim() || !organizationId || loading}
            className={`h-10 px-3 rounded-lg items-center justify-center ${!query.trim() || !organizationId || loading ? 'bg-gray-300' : 'bg-zinc-900'}`}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText lightColor="#ffffff" darkColor="#ffffff">Search</ThemedText>
            )}
          </Pressable>
        </View>

        {!loading && hasSearched && results.length === 0 ? (
          <ThemedText className="text-gray-500 dark:text-gray-400 mt-4">No results</ThemedText>
        ) : null}
        {loading ? (
          <View className="mt-6 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : null}

        {results.length > 0 ? (
          <View className="mt-2">
            {results.map((item, idx) => (
              <View key={`${item.session_id}-${idx}`} className="border border-gray-200 dark:border-zinc-800 rounded-lg p-3 mb-2">
                <View className="flex-row items-center justify-between mb-1">
                  <ThemedText className="text-sm text-gray-500 dark:text-gray-400">
                    {item.session_title || 'Untitled Session'}
                  </ThemedText>
                  <ThemedText className="text-xs text-gray-400">
                    {item.duration_seconds != null ? formatDuration(item.duration_seconds) : ''}
                  </ThemedText>
                </View>
                <Text className="text-foreground">{item.content}</Text>
                <View className="flex-row items-center justify-between mt-2">
                  <ThemedText className="text-xs text-gray-500 dark:text-gray-400">
                    {item.start_time_seconds != null ? `At ${formatDuration(item.start_time_seconds)}` : ''}
                  </ThemedText>
                  <Pressable onPress={() => onCopy(item.content)} className="px-3 py-1 rounded bg-zinc-900">
                    <ThemedText className="text-white text-xs">Copy</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ThemedView>
    </ParallaxScrollView>
  );
}


