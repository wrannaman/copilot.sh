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

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    if (deviceOrgId && session.organization_id !== deviceOrgId) return NextResponse.json({ message: 'Forbidden' }, { status: 403 })

    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ message: 'Expected multipart/form-data' }, { status: 400 })
    }
    const form = await request.formData()
    const file = form.get('file')
    const mimeType = form.get('mimeType') || ''
    if (!file || typeof file === 'string') {
      return NextResponse.json({ message: 'Missing file' }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // pick extension
    let ext = 'webm'
    if (String(mimeType).includes('ogg')) ext = 'ogg'
    else if (String(mimeType).includes('mp4') || String(mimeType).includes('m4a')) ext = 'm4a'
    else if (String(mimeType).includes('wav')) ext = 'wav'
    else if (String(mimeType).includes('flac')) ext = 'flac'

    const svc = createServiceClient()
    const path = `audio/${session.organization_id}/${session.id}.${ext}`
    const { error: upErr } = await svc.storage.from('copilot.sh').upload(path, buffer, { upsert: true, contentType: mimeType || 'application/octet-stream' })
    if (upErr) return NextResponse.json({ message: 'Upload failed', details: upErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, path })
  } catch (e) {
    return NextResponse.json({ message: 'Upload failed', details: e?.message }, { status: 500 })
  }
}


