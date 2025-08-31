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

    let body = {}
    try { body = await request.json() } catch { }
    const mimeType = String(body?.mimeType || '')
    const ext = (
      mimeType.includes('ogg') ? 'ogg' :
        (mimeType.includes('webm') ? 'webm' :
          ((mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('aac')) ? 'm4a' :
            (mimeType.includes('wav') ? 'wav' :
              (mimeType.includes('flac') ? 'flac' :
                (mimeType.includes('mp3') ? 'mp3' : 'webm')))))
    )

    const svc = createServiceClient()
    const path = `audio/${session.organization_id}/${session.id}/000000.${ext}`
    const { data: signed, error } = await svc.storage
      .from('copilot.sh')
      .createSignedUploadUrl(path, { upsert: true, contentType: mimeType || 'application/octet-stream' })
    if (error) return NextResponse.json({ message: 'Failed to sign upload', details: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, path, token: signed?.token })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to sign upload', details: e?.message }, { status: 500 })
  }
}


