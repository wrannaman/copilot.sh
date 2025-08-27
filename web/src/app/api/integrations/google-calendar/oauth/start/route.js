import { NextResponse } from 'next/server'
import { createAuthClient } from '@/utils/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
// Use the whitelisted callback path from Google console
const REDIRECT_URI = `${APP_URL}/api/integrations/google-calendar/callback`
// Do not pre-encode; URLSearchParams will encode properly
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email'

export async function GET() {
  if (!GOOGLE_CLIENT_ID || !APP_URL) {
    return NextResponse.json({ error: 'Missing Google OAuth configuration' }, { status: 500 })
  }

  const supabase = await createAuthClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const state = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPE,
    state,
    include_granted_scopes: 'true',
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  const res = NextResponse.redirect(url)
  res.cookies.set('gcal_oauth_state', state, { path: '/', httpOnly: true, sameSite: 'lax' })
  return res
}


