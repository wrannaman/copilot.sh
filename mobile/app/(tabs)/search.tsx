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
      headerBackgroundColor={{ light: '#f8fafc', dark: '#0f172a' }}
      headerImage={
        <View className="flex-1 bg-gradient-to-br from-emerald-50 via-blue-50 to-indigo-50 dark:from-gray-900 dark:via-slate-900 dark:to-indigo-900" />
      }
    >
      <ThemedView className="gap-6">
        <View className="items-center">
          <ThemedText type="title" className="text-gray-900 dark:text-white">Search</ThemedText>
          <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-1">
            Find conversations, topics, and commitments
          </ThemedText>
        </View>

        <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700/50">
          <View className="flex-row items-center gap-3">
            <View className="flex-1 relative">
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search conversations, topics, commitments..."
                className="border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 pr-12"
              />
              <View className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <View className="w-5 h-5 bg-gray-400 dark:bg-gray-500 rounded-full items-center justify-center">
                  <Text className="text-white text-xs">🔍</Text>
                </View>
              </View>
            </View>
            <Pressable
              onPress={onSearch}
              disabled={!query.trim() || !organizationId || loading}
              className={`px-6 py-3 rounded-xl items-center justify-center shadow-md ${!query.trim() || !organizationId || loading
                ? 'bg-gray-300 dark:bg-gray-600'
                : 'bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600'
                }`}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <ThemedText className="text-white font-semibold">Search</ThemedText>
              )}
            </Pressable>
          </View>
        </View>

        {!loading && hasSearched && results.length === 0 ? (
          <View className="bg-gray-50 dark:bg-gray-800/30 rounded-2xl p-8 items-center">
            <View className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full items-center justify-center mb-4">
              <Text className="text-2xl">🔍</Text>
            </View>
            <ThemedText className="text-gray-600 dark:text-gray-400 text-center font-medium">No results found</ThemedText>
            <ThemedText className="text-gray-500 dark:text-gray-500 text-center text-sm mt-1">Try different keywords or phrases</ThemedText>
          </View>
        ) : null}

        {loading ? (
          <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-8 items-center shadow-sm border border-gray-100 dark:border-gray-700/50">
            <ActivityIndicator size="large" color="#3b82f6" />
            <ThemedText className="text-gray-600 dark:text-gray-400 mt-3 font-medium">Searching...</ThemedText>
          </View>
        ) : null}

        {results.length > 0 ? (
          <View className="gap-3">
            <ThemedText className="text-lg font-semibold text-gray-900 dark:text-white">
              Found {results.length} result{results.length === 1 ? '' : 's'}
            </ThemedText>
            {results.map((item, idx) => (
              <View key={`${item.session_id}-${idx}`} className="bg-white dark:bg-gray-800/50 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700/50">
                <View className="flex-row items-start justify-between mb-3">
                  <View className="flex-1">
                    <ThemedText className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                      {item.session_title || 'Untitled Session'}
                    </ThemedText>
                    <ThemedText className="text-sm text-blue-600 dark:text-blue-400">
                      {item.start_time_seconds != null ? `At ${formatDuration(item.start_time_seconds)}` : ''}
                    </ThemedText>
                  </View>
                  <View className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-lg">
                    <ThemedText className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      {item.duration_seconds != null ? formatDuration(item.duration_seconds) : ''}
                    </ThemedText>
                  </View>
                </View>

                <View className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3 mb-3 border-l-4 border-blue-500">
                  <Text className="text-gray-800 dark:text-gray-200 leading-relaxed">{item.content}</Text>
                </View>

                <Pressable
                  onPress={() => onCopy(item.content)}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600 px-4 py-2 rounded-lg shadow-sm self-end"
                >
                  <ThemedText className="text-white font-medium text-sm">Copy Text</ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ThemedView>
    </ParallaxScrollView>
  );
}


