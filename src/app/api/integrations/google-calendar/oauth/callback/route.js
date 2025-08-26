import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
// Must match the whitelisted redirect URI in Google console
const REDIRECT_URI = `${APP_URL}/api/integrations/google-calendar/callback`

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  })
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const data = await resp.json()
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || 'Token exchange failed')
  }
  return data
}

export async function GET(request) {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !APP_URL) {
      return NextResponse.json({ error: 'Missing Google OAuth configuration' }, { status: 500 })
    }

    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      return NextResponse.redirect(`${APP_URL}/integrations?error=oauth_denied`)
    }
    if (!code || !state) {
      return NextResponse.redirect(`${APP_URL}/integrations?error=missing_params`)
    }

    const cookieState = request.cookies.get('gcal_oauth_state')?.value
    if (!cookieState || cookieState !== state) {
      return NextResponse.redirect(`${APP_URL}/integrations?error=invalid_state`)
    }

    const supabase = await createAuthClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      console.log('[google-calendar-callback] Auth error:', userError)
      return NextResponse.redirect(`${APP_URL}/integrations?error=unauthorized`)
    }

    // Find org
    const { data: memberships, error: orgError } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)

    const organizationId = memberships?.[0]?.organization_id
    if (!organizationId) {
      return NextResponse.redirect(`${APP_URL}/integrations?error=no_org`)
    }

    // Exchange code
    const tokens = await exchangeCodeForTokens(code)
    console.log('[google-calendar-callback] Tokens received:', {
      access_token: tokens.access_token ? '***REDACTED***' : 'MISSING',
      refresh_token: tokens.refresh_token ? '***REDACTED***' : 'MISSING',
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      token_type: tokens.token_type
    })

    // Fetch userinfo to get email
    const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const userinfo = await userinfoResp.json()
    console.log('[google-calendar-callback] Google userinfo response:', {
      status: userinfoResp.status,
      data: userinfo
    })

    // Also fetch calendar info to see what calendars they have access to
    const calendarsResp = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const calendarsData = await calendarsResp.json()
    console.log('[google-calendar-callback] Google calendars response:', {
      status: calendarsResp.status,
      calendarCount: calendarsData.items?.length || 0,
      calendars: calendarsData.items?.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        primary: cal.primary,
        accessRole: cal.accessRole,
        colorId: cal.colorId
      })) || []
    })

    const service = createServiceClient()
    // Upsert integration (one per org/type)
    const accountEmail = userinfo?.email || null
    const integrationData = {
      organization_id: organizationId,
      type: 'google_calendar',
      connected_by: user.id,
      account_email: accountEmail,
      access_json: {
        email: accountEmail,
        tokens,
        setup_method: 'oauth',
        connected_at: new Date().toISOString()
      },
      scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    }

    const { error: upsertError } = await service
      .from('integrations')
      .upsert(integrationData, { onConflict: 'organization_id,type,account_email' })
      .select('id')
      .single()

    if (upsertError) {
      console.error('[google-calendar-callback] Upsert failed:', upsertError)
      return NextResponse.redirect(`${APP_URL}/integrations?error=save_failed`)
    }

    const res = NextResponse.redirect(`${APP_URL}/integrations?success=google_calendar_connected`)
    res.cookies.set('gcal_oauth_state', '', { path: '/', maxAge: 0 })
    return res
  } catch (e) {
    return NextResponse.redirect(`${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/integrations?error=connection_failed&details=${encodeURIComponent(e.message)}`)
  }
}


