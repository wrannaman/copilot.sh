import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import 'react-native-reanimated';
import '../global.css';
import { colorScheme } from 'nativewind';

import { useColorScheme } from '@/hooks/useColorScheme';

export default function RootLayout() {
  const systemColorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    // Set NativeWind to follow system theme
    colorScheme.set(systemColorScheme ?? 'light');
  }, [systemColorScheme]);

  useEffect(() => {
    // Load persisted settings for API base
    (async () => {
      try {
        const apiBase = await AsyncStorage.getItem('copilot.apiBaseUrl');
        if (apiBase) (globalThis as any).__COPILOT_API_BASE_URL__ = apiBase;
      } catch { }
    })();
    // Seed from app.json extras if nothing set yet
    const extras = (Constants?.expoConfig?.extra || {}) as any;
    if (!(globalThis as any).__COPILOT_API_BASE_URL__ && extras.apiBaseUrl) {
      (globalThis as any).__COPILOT_API_BASE_URL__ = extras.apiBaseUrl;
    }
    if (!(globalThis as any).__SUPABASE_URL__ && extras.supabaseUrl) {
      (globalThis as any).__SUPABASE_URL__ = extras.supabaseUrl;
    }
    if (!(globalThis as any).__SUPABASE_ANON__ && extras.supabaseAnon) {
      (globalThis as any).__SUPABASE_ANON__ = extras.supabaseAnon;
    }
  }, []);

  if (!loaded) {
    // Async font loading only occurs in development.
    return null;
  }

  return (
    <ThemeProvider value={systemColorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="sessions/[id]"
          options={{
            headerShown: true,
            title: "Session Details",
            headerBackTitle: "Sessions"
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
