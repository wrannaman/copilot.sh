import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const KEY_URL = 'copilot.supabaseUrl'
const KEY_ANON = 'copilot.supabaseAnonKey'

let cachedClient: SupabaseClient | null = null
let cachedKey = ''

export function getSupabase() {
  const url = (globalThis as any).__SUPABASE_URL__ || process.env.EXPO_PUBLIC_SUPABASE_URL || ''
  const anon = (globalThis as any).__SUPABASE_ANON__ || process.env.EXPO_PUBLIC_SUPABASE_ANON || ''
  const key = `${url}|${anon}`
  if (cachedClient && cachedKey === key) return cachedClient
  cachedClient = createClient(url, anon, {
    auth: {
      flowType: 'pkce',
      storage: AsyncStorage as any,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  cachedKey = key
  return cachedClient
}

export async function setSupabaseConfig(url: string, anon: string) {
  await AsyncStorage.setItem(KEY_URL, url)
  await AsyncStorage.setItem(KEY_ANON, anon)
    ; (globalThis as any).__SUPABASE_URL__ = url
    ; (globalThis as any).__SUPABASE_ANON__ = anon
  cachedClient = null
  cachedKey = ''
}


