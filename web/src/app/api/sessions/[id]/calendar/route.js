import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function authAny(request) {
  let supabase = await createAuthClient()
  let { data, error } = await supabase.auth.getUser()
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
      } catch { }
    }
    if (!data?.user) {
      const deviceKey = headerKey || (!bearer ? '' : '')
      if (!deviceKey) return { supabase: null, data: null, deviceOrgId: null }
      const svc = createServiceClient()
      const { data: deviceRow } = await svc
        .from('device_api_keys')
        .select('user_id, organization_id, active')
        .eq('key', deviceKey)
        .maybeSingle()
      if (!deviceRow || deviceRow.active === false) return { supabase: null, data: null, deviceOrgId: null }
      supabase = svc
      deviceOrgId = deviceRow.organization_id
    }
  }
  return { supabase, data, deviceOrgId }
}

export async function POST(request, { params }) {
  try {
    const { supabase, data, deviceOrgId } = await authAny(request)
    if (!data?.user && !deviceOrgId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const calendarEventId = typeof body?.calendar_event_id === 'string' ? body.calendar_event_id : null
    const calendarEventRef = typeof body?.calendar_event_ref === 'string' ? body.calendar_event_ref : null

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    if (deviceOrgId && session.organization_id !== deviceOrgId) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const update = {}
    if (calendarEventId != null) update.calendar_event_id = calendarEventId
    if (calendarEventRef != null) {
      // Validate event belongs to the same organization
      const svc = createServiceClient()
      const { data: ev } = await svc
        .from('calendar_events')
        .select('id, organization_id')
        .eq('id', calendarEventRef)
        .maybeSingle()
      if (!ev || ev.organization_id !== session.organization_id) {
        return NextResponse.json({ message: 'Invalid calendar event' }, { status: 400 })
      }
      update.calendar_event_ref = calendarEventRef
    }

    await supabase.from('sessions').update(update).eq('id', sessionId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to link calendar event', details: e?.message }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const { supabase, data, deviceOrgId } = await authAny(request)
    if (!data?.user && !deviceOrgId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    if (deviceOrgId && session.organization_id !== deviceOrgId) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    await supabase
      .from('sessions')
      .update({ calendar_event_ref: null })
      .eq('id', sessionId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to unlink calendar event', details: e?.message }, { status: 500 })
  }
}


