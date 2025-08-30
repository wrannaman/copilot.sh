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

export async function GET(request, { params }) {
  try {
    const { supabase, data, deviceOrgId } = await authAny(request)
    if (!data?.user && !deviceOrgId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id, status, transcript_storage_path, created_at, started_at, ended_at, duration_seconds')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    if (deviceOrgId && session.organization_id !== deviceOrgId) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const svc = createServiceClient()
    // List audio parts
    const prefix = `audio/${session.organization_id}/${session.id}`
    let totalParts = 0
    try {
      const { data: files } = await svc.storage.from('copilot.sh').list(prefix, { limit: 10000, sortBy: { column: 'name', order: 'asc' } })
      totalParts = (files || []).filter(f => f.name.endsWith('.webm') || f.name.endsWith('.ogg') || f.name.endsWith('.m4a')).length
    } catch { }

    // Read progress (prefer worker-progress)
    let processed = 0
    let lastSeq = -1
    try {
      const { data: wblob } = await svc.storage.from('copilot.sh').download(`${prefix}/worker-progress.json`)
      if (wblob) {
        const txt = await wblob.text(); const json = JSON.parse(txt)
        processed = json?.processed || 0
      } else {
        const progressPath = `${prefix}/finalize.json`
        const { data: blob } = await svc.storage.from('copilot.sh').download(progressPath)
        if (blob) {
          const txt = await blob.text()
          const json = JSON.parse(txt)
          processed = json?.processedCount || 0
          lastSeq = json?.lastSeq ?? -1
        }
      }
    } catch { }

    return NextResponse.json({
      id: session.id,
      status: session.status,
      parts: totalParts,
      processed,
      lastSeq,
      transcript_path: session.transcript_storage_path || null,
      started_at: session.started_at,
      ended_at: session.ended_at,
      duration_seconds: session.duration_seconds || null
    })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to get status', details: e?.message }, { status: 500 })
  }
}


