import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Worker delegation – no in-process speech on Vercel

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

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id, status')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    if (deviceOrgId && session.organization_id !== deviceOrgId) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const svc = createServiceClient()
    const prefix = `audio/${session.organization_id}/${session.id}`
    const { data: files } = await svc.storage.from('copilot.sh').list(prefix, { limit: 10000, sortBy: { column: 'name', order: 'asc' } })
    const parts = (files || []).filter(f => f.name.endsWith('.webm') || f.name.endsWith('.ogg') || f.name.endsWith('.m4a'))
    if (parts.length === 0) {
      console.error('[finalize] no parts found for', { sessionId, prefix })
      return NextResponse.json({ message: 'No audio parts to process' }, { status: 400 })
    }

    // New model: mark session as uploaded; worker will poll and process
    let body = {}
    try { body = await request.json() } catch { }
    const title = typeof body?.title === 'string' ? body.title.slice(0, 200) : null
    const summaryPrompt = typeof body?.summary_prompt === 'string' ? body.summary_prompt.slice(0, 2000) : null
    const update = { status: 'uploaded' }
    if (title) update.title = title
    if (typeof summaryPrompt === 'string') update.summary_prompt = summaryPrompt
    await supabase.from('sessions').update(update).eq('id', sessionId)
    return NextResponse.json({ ok: true, queued: true, status: 'uploaded' })
  } catch (e) {
    return NextResponse.json({ message: 'Finalize enqueue failed', details: e?.message }, { status: 500 })
  }
}


