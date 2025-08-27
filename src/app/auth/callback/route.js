import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const next = url.searchParams.get('next') || '/dashboard'
    const code = url.searchParams.get('code')
    const token_hash = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type')

    // 1) Complete auth as the user (SSR client with anon key + cookies)
    const supabase = await createClient()
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) return NextResponse.redirect(new URL('/auth/login', request.url))
    } else if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash })
      if (error) return NextResponse.redirect(new URL('/auth/login', request.url))
    } else {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // 2) Ensure org idempotently (SECURITY DEFINER RPC) and set cookie
    const { data: userRes } = await supabase.auth.getUser()
    const user = userRes?.user
    if (!user) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    const preferred_name =
      (user.user_metadata && user.user_metadata.full_name) ||
      (user.email && user.email.split('@')[0]) ||
      'Personal'

    const { data: orgId, error: orgErr } = await supabase.rpc('ensure_current_user_org', {
      preferred_name,
    })
    if (orgErr || !orgId) {
      return NextResponse.redirect(new URL('/error?code=org_init_failed', request.url))
    }

    // Notify Slack once on fresh signup (within 30s of account creation)
    try {
      const webhook = process.env.SLACK_WEBHOOK_URL
      if (webhook && user.created_at) {
        const createdAt = new Date(user.created_at)
        const isRecent = (Date.now() - createdAt.getTime()) <= 30_000
        if (isRecent) {
          const email = user.email || 'unknown'
          await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `copilot.sh - ${email} signed up` })
          })
        }
      }
    } catch { }

    const res = NextResponse.redirect(new URL(next, request.url))
    res.cookies.set('org_id', String(orgId), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    return res
  } catch {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }
}


