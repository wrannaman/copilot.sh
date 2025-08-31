import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  try {
    let supabase = await createAuthClient()
    let { data, error } = await supabase.auth.getUser()
    let deviceMode = false
    let deviceOrgId = null

    if (error || !data?.user) {
      const authHeader = request.headers.get('authorization') || ''
      const headerKey = request.headers.get('x-device-key') || ''
      const bearer = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : ''

      if (bearer) {
        try {
          const svc = createServiceClient()
          const { data: jwtUser, error: jwtErr } = await svc.auth.getUser(bearer)
          if (!jwtErr && jwtUser?.user) {
            data = { user: jwtUser.user }
            supabase = svc
          }
        } catch (_) { }
      }

      if (!data?.user) {
        const deviceKey = headerKey || (!bearer ? '' : '')
        if (!deviceKey) {
          return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
        }
        const svc = createServiceClient()
        const { data: deviceRow } = await svc
          .from('device_api_keys')
          .select('user_id, organization_id, active')
          .eq('key', deviceKey)
          .maybeSingle()
        if (!deviceRow || deviceRow.active === false) {
          return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
        }
        deviceMode = true
        deviceOrgId = deviceRow.organization_id
        supabase = svc
        svc.from('device_api_keys').update({ last_used_at: new Date().toISOString() }).eq('key', deviceKey).then(() => { }).catch(() => { })
      }
    }

    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const { data: session, error: sErr } = await supabase
      .from('sessions')
      .select('id, organization_id, started_at')
      .eq('id', sessionId)
      .maybeSingle()

    if (sErr || !session) {
      return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    }
    if (deviceMode && deviceOrgId && session.organization_id !== deviceOrgId) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    const endedAt = new Date()
    const startedAt = session.started_at ? new Date(session.started_at) : null
    const durationSeconds = startedAt ? Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)) : null

    const { error: uErr } = await supabase
      .from('sessions')
      .update({
        status: 'uploaded',
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds
      })
      .eq('id', sessionId)

    if (uErr) {
      return NextResponse.json({ message: 'Failed to stop session', details: uErr.message }, { status: 500 })
    }

    // Final pass diarization/job can be kicked off here in background later.
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to stop session', details: e?.message }, { status: 500 })
  }
}


