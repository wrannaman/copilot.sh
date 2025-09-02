import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, Pressable, RefreshControl, Text } from 'react-native';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getSupabase } from '@/lib/supabase';
import { useRouter, useFocusEffect } from 'expo-router';

type SessionRow = {
  id: string;
  title?: string | null;
  status?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
};

function formatTime(dateString?: string | null) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateString?: string | null) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString();
}

export default function SessionsScreen() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const pageSize = 5;
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase.rpc('my_organizations');
        if (!error && Array.isArray(data) && data.length > 0) {
          setOrganizationId(String(data[0].org_id));
        }
      } catch { }
    })();
  }, []);

  const loadSessions = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize; // request one extra to detect next page
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('sessions')
        .select('id,title,status,created_at,started_at,ended_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .range(startIndex, endIndex);
      if (!error && Array.isArray(data)) {
        const hasMore = data.length > pageSize;
        setHasNextPage(hasMore);
        setSessions(hasMore ? (data as any).slice(0, pageSize) : (data as any));
      } else {
        setHasNextPage(false);
        setSessions([]);
      }
    } finally {
      setLoading(false);
    }
  }, [organizationId, page]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Reset to page 1 on pull-to-refresh
      setPage(1);
      // Wait for state to apply, then load
      setTimeout(() => {
        loadSessions();
      }, 0);
    } finally {
      setRefreshing(false);
    }
  }, [loadSessions]);

  useEffect(() => {
    if (!organizationId) return;
    loadSessions();
  }, [organizationId, loadSessions]);

  useEffect(() => {
    // Reset to first page when org changes
    setPage(1);
  }, [organizationId]);

  // Refresh when the tab/screen gains focus
  useFocusEffect(
    useCallback(() => {
      if (!organizationId) return;
      onRefresh();
    }, [organizationId, onRefresh])
  );

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#f8fafc', dark: '#0f172a' }}
      headerImage={
        <View className="flex-1 bg-purple-50 dark:bg-gray-900" />
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <ThemedView className="gap-6">
        <View className="items-center">
          <ThemedText type="title" className="text-gray-900 dark:text-white">Sessions</ThemedText>
          <ThemedText className="text-gray-500 dark:text-gray-400 text-center mt-1">
            Your recorded conversations and meetings
          </ThemedText>
        </View>

        {loading ? (
          <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-8 items-center  border border-gray-100 dark:border-gray-700/50">
            <ActivityIndicator size="large" color="#10b981" />
            <ThemedText className="text-gray-600 dark:text-gray-400 mt-3 font-medium">Loading sessions...</ThemedText>
          </View>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <View className="bg-gray-50 dark:bg-gray-800/30 rounded-2xl p-8 items-center">
            <View className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full items-center justify-center mb-4">
              <Text className="text-2xl">🎤</Text>
            </View>
            <ThemedText className="text-gray-600 dark:text-gray-400 text-center font-medium">No sessions yet</ThemedText>
            <ThemedText className="text-gray-500 dark:text-gray-500 text-center text-sm mt-1">Start recording to see your sessions here</ThemedText>
          </View>
        ) : null}

        <View className="gap-2">
          {sessions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: s.id } })}
              className="bg-white dark:bg-gray-800/50 rounded-xl p-3  border border-gray-100 dark:border-gray-700/50 active:scale-98 transition-transform"
            >
              <View className="flex-row items-center">
                <View className="flex-1">
                  {/* Row 1: Name | Status */}
                  <View className="flex-row items-center justify-between mb-2">
                    <ThemedText className="text-base font-semibold text-gray-900 dark:text-white flex-1 pr-3">
                      {s.title || 'Untitled Session'}
                    </ThemedText>
                    <View className={`px-2 py-0.5 rounded-full ${s.status === 'ready' ? 'bg-green-100 dark:bg-green-900/30' :
                      s.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                        'bg-gray-100 dark:bg-gray-700'
                      }`}>
                      <ThemedText className={`text-xs font-medium capitalize ${s.status === 'ready' ? 'text-green-700 dark:text-green-400' :
                        s.status === 'processing' ? 'text-yellow-700 dark:text-yellow-400' :
                          'text-gray-600 dark:text-gray-400'
                        }`}>
                        {s.status || 'unknown'}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Row 2: Date | Start - End */}
                  <View className="flex-row items-center justify-between">
                    <ThemedText className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(s.started_at || s.created_at)}
                    </ThemedText>
                    <ThemedText className="text-xs text-gray-500 dark:text-gray-400">
                      {s.started_at && s.ended_at ?
                        `${formatTime(s.started_at)} - ${formatTime(s.ended_at)}` :
                        s.started_at ?
                          `Started ${formatTime(s.started_at)}` :
                          ''
                      }
                    </ThemedText>
                  </View>
                </View>
                <View className="w-6 h-6 bg-gray-100 dark:bg-gray-700 rounded-full items-center justify-center ml-3">
                  <Text className="text-sm text-gray-600 dark:text-gray-400">›</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        <View className="bg-white dark:bg-gray-800/50 rounded-2xl p-4  border border-gray-100 dark:border-gray-700/50">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => setPage(p => Math.max(1, p - 1))}
              disabled={loading || page === 1}
              className="px-4 py-2"
            >
              <ThemedText className={`font-medium ${loading || page === 1 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                ← Previous
              </ThemedText>
            </Pressable>

            <ThemedText className="text-sm font-semibold text-gray-600 dark:text-gray-400">Page {page}</ThemedText>

            <Pressable
              onPress={() => setPage(p => p + 1)}
              disabled={loading || !hasNextPage}
              className="px-4 py-2"
            >
              <ThemedText className={`font-medium ${loading || !hasNextPage ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                Next →
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </ThemedView>
    </ParallaxScrollView >
  );
}


