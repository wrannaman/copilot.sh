import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { router } from 'expo-router'
import { getSupabase } from '@/lib/supabase'

export default function Index() {
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let mounted = true
      ; (async () => {
        try {
          const supabase = getSupabase()
          const { data } = await supabase.auth.getSession()
          if (!mounted) return
          if (data?.session) router.replace('/(tabs)/record')
          else router.replace('/login')
        } finally {
          if (mounted) setChecked(true)
        }
      })()
    return () => { mounted = false }
  }, [])

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  )
}


