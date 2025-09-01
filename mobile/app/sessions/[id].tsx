import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, ScrollView, Pressable, Alert, Text } from 'react-native';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { getSupabase } from '@/lib/supabase';

type SummaryPayload = {
  summary?: string;
  action_items?: string[];
  topics?: string[];
};

export default function SessionDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [sessionInfo, setSessionInfo] = useState<{ title?: string; created_at?: string } | null>(null);

  const apiBaseUrl = useMemo(() => (globalThis as any).__COPILOT_API_BASE_URL__ || 'http://localhost:3000', []);

  const loadDetails = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || '';

      // Load session basic info
      try {
        const { data: sessionMeta } = await supabase
          .from('sessions')
          .select('title, created_at')
          .eq('id', id)
          .single();
        setSessionInfo(sessionMeta);
      } catch (e) {
        console.log('[session] failed to load session info', e);
      }

      // Transcript
      try {
        const resp = await fetch(`${apiBaseUrl}/api/sessions/${id}/transcript`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        if (resp.ok) setTranscript(await resp.text());
        else setTranscript('No transcript available yet.');
      } catch {
        setTranscript('Failed to load transcript.');
      }
      // Summary (generate if absent)
      try {
        const resp = await fetch(`${apiBaseUrl}/api/sessions/${id}/summarize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });
        if (resp.ok) {
          const json = await resp.json();
          setSummary({
            summary: json?.summary || '',
            action_items: Array.isArray(json?.action_items) ? json.action_items : [],
            topics: Array.isArray(json?.topics) ? json.topics : [],
          });
        } else {
          setSummary({ summary: '', action_items: [], topics: [] });
        }
      } catch {
        setSummary({ summary: '', action_items: [], topics: [] });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, id]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  // Update navigation title when session info is loaded
  useEffect(() => {
    if (sessionInfo?.title) {
      navigation.setOptions({
        title: sessionInfo.title
      });
    }
  }, [sessionInfo?.title, navigation]);

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
        <View className="flex-1 bg-emerald-50 dark:bg-gray-900" />
      }
      includeTopInset={false}
      contentPadding={16}
    >
      <ThemedView className="gap-4">
        <View className="items-center">
          <ThemedText type="title" className="text-gray-900 dark:text-white text-center">
            {sessionInfo?.title || 'Untitled Session'}
          </ThemedText>
          {sessionInfo?.created_at && (
            <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-1 text-sm">
              {new Date(sessionInfo.created_at).toLocaleDateString()} at {new Date(sessionInfo.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </ThemedText>
          )}
        </View>

        {loading ? (
          <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-8 items-center  border border-gray-100 dark:border-gray-700/50">
            <ActivityIndicator size="large" color="#10b981" />
            <ThemedText className="text-gray-600 dark:text-gray-400 mt-3 font-medium">Loading session...</ThemedText>
          </View>
        ) : (
          <ScrollView className="gap-4">
            <View className="bg-white dark:bg-gray-800/50 rounded-2xl  border border-gray-100 dark:border-gray-700/50 overflow-hidden">
              <View className="bg-emerald-600 p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mr-3">
                      <Text className="text-xl">🤖</Text>
                    </View>
                    <ThemedText className="text-lg font-semibold text-white">AI Summary</ThemedText>
                  </View>
                  <Pressable
                    onPress={() => onCopy(((summary?.summary || '') + ((summary?.action_items?.length || 0) ? `\n\nAction items:\n- ${summary?.action_items?.join('\n- ')}` : '') + ((summary?.topics?.length || 0) ? `\n\nTopics:\n- ${summary?.topics?.join('\n- ')}` : '')).trim())}
                    className="bg-white/20 px-3 py-1.5 rounded-lg"
                  >
                    <ThemedText className="text-white font-medium text-sm">Copy All</ThemedText>
                  </Pressable>
                </View>
              </View>

              <View className="p-4">
                {summary && (summary.summary || (summary.action_items?.length || summary.topics?.length)) ? (
                  <View className="gap-4">
                    {summary.summary ? (
                      <View>
                        <ThemedText className="text-base font-semibold text-gray-900 dark:text-white mb-2">Summary</ThemedText>
                        <ThemedText className="text-gray-700 dark:text-gray-300 leading-relaxed">{summary.summary}</ThemedText>
                      </View>
                    ) : null}

                    {Array.isArray(summary.action_items) && summary.action_items.length > 0 ? (
                      <View>
                        <ThemedText className="text-base font-semibold text-gray-900 dark:text-white mb-3">Action Items</ThemedText>
                        <View className="gap-2">
                          {summary.action_items.map((it, idx) => (
                            <View key={idx} className="flex-row items-start">
                              <View className="w-2 h-2 bg-green-500 rounded-full mt-2 mr-3" />
                              <ThemedText className="text-gray-700 dark:text-gray-300 flex-1 leading-relaxed">{it}</ThemedText>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {Array.isArray(summary.topics) && summary.topics.length > 0 ? (
                      <View>
                        <ThemedText className="text-base font-semibold text-gray-900 dark:text-white mb-3">Topics</ThemedText>
                        <View className="flex-row flex-wrap gap-2">
                          {summary.topics.map((t, idx) => (
                            <View key={idx} className="bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                              <ThemedText className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{t}</ThemedText>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View className="items-center py-8">
                    <View className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full items-center justify-center mb-4">
                      <Text className="text-2xl">📝</Text>
                    </View>
                    <ThemedText className="text-gray-500 dark:text-gray-400 text-center font-medium">No summary available</ThemedText>
                    <ThemedText className="text-gray-400 dark:text-gray-500 text-center text-sm mt-1">Summary will appear here once generated</ThemedText>
                  </View>
                )}
              </View>
            </View>

            <View className="bg-white dark:bg-gray-800/50 rounded-2xl  border border-gray-100 dark:border-gray-700/50 overflow-hidden">
              <View className="bg-gray-600 p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mr-3">
                      <Text className="text-xl">📄</Text>
                    </View>
                    <ThemedText className="text-lg font-semibold text-white">Transcript</ThemedText>
                  </View>
                  <Pressable
                    onPress={() => onCopy(transcript || '')}
                    className="bg-white/20 px-3 py-1.5 rounded-lg"
                  >
                    <ThemedText className="text-white font-medium text-sm">Copy</ThemedText>
                  </Pressable>
                </View>
              </View>

              <View className="p-4">
                {transcript && transcript.trim() ? (
                  <ThemedText className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{transcript}</ThemedText>
                ) : (
                  <View className="items-center py-8">
                    <View className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full items-center justify-center mb-4">
                      <Text className="text-2xl">⏳</Text>
                    </View>
                    <ThemedText className="text-gray-500 dark:text-gray-400 text-center font-medium">No transcript available</ThemedText>
                    <ThemedText className="text-gray-400 dark:text-gray-500 text-center text-sm mt-1">Transcript will appear here once processed</ThemedText>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        )}
      </ThemedView>
    </ParallaxScrollView>
  );
}


