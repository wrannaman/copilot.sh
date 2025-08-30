import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sniffExt(mime, bytes) {
  try {
    const sig4 = Buffer.from(bytes).subarray(0, 4)
    const ascii = (() => { try { return sig4.toString('utf8') } catch { return '' } })()
    const isOgg = ascii === 'OggS' || String(mime).includes('ogg')
    const isWebm = sig4.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) || String(mime).includes('webm')
    if (isOgg) return 'ogg'
    if (isWebm) return 'webm'
  } catch { }
  return 'bin'
}

function getSpeechClient() {
  const { SpeechClient } = require('@google-cloud/speech')
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  if (gac.trim().startsWith('{')) {
    try {
      const json = JSON.parse(gac)
      const projectId = json.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
      if (!json.client_email || !json.private_key) {
        throw new Error('Missing client_email or private_key in GOOGLE_APPLICATION_CREDENTIALS JSON')
      }
      return new SpeechClient({ projectId, credentials: { client_email: json.client_email, private_key: json.private_key } })
    } catch (e) {
      console.error('[speech] Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON:', e?.message)
      throw e
    }
  }
  return new SpeechClient()
}

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

    // Verify session is accessible and get org id
    const { data: session, error: sErr } = await supabase
      .from('sessions')
      .select('id, organization_id, status, started_at')
      .eq('id', sessionId)
      .maybeSingle()

    if (sErr || !session) {
      return NextResponse.json({ message: 'Session not found' }, { status: 404 })
    }
    if (deviceMode && deviceOrgId && session.organization_id !== deviceOrgId) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 })
    }

    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ message: 'Expected multipart/form-data' }, { status: 400 })
    }
    const form = await request.formData()
    const file = form.get('chunk')
    const mimeType = form.get('mimeType') || ''
    const seqStr = String(form.get('seq') || '').trim()
    const seq = Number.isFinite(Number(seqStr)) ? Number(seqStr) : null
    if (!file || typeof file === 'string') {
      return NextResponse.json({ message: 'Missing audio chunk' }, { status: 400 })
    }
    if (seq == null) {
      return NextResponse.json({ message: 'Missing seq' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const ext = sniffExt(mimeType, buffer)

    const svc = createServiceClient()
    const partName = `${String(seq).padStart(6, '0')}.${ext}`
    const storageDir = `audio/${session.organization_id}/${session.id}`
    const storagePath = `${storageDir}/${partName}`
    const { error: upErr } = await svc.storage
      .from('copilot.sh')
      .upload(storagePath, buffer, { upsert: true, contentType: mimeType || 'application/octet-stream' })

    if (upErr) {
      return NextResponse.json({ message: 'Failed to store audio', details: upErr.message }, { status: 500 })
    }
    console.log('[chunk] saved part', { sessionId, partName, bytes: buffer.byteLength, mimeType })

    // Maintain a combined single file alongside parts for single-pass processing
    try {
      // Determine combined path, prefer existing ext if present
      const tryExts = ['ogg', 'webm', 'm4a', 'wav', 'flac']
      let combinedPath = ''
      let existingBuf = null
      for (const e of tryExts) {
        try {
          const p = `audio/${session.organization_id}/${session.id}.${e}`
          const { data: ex } = await svc.storage.from('copilot.sh').download(p)
          if (ex) {
            existingBuf = Buffer.from(await ex.arrayBuffer())
            combinedPath = p
            break
          }
        } catch { }
      }
      if (!combinedPath) {
        combinedPath = `audio/${session.organization_id}/${session.id}.${ext}`
      }
      const newBuf = existingBuf ? Buffer.concat([existingBuf, buffer]) : buffer
      await svc.storage.from('copilot.sh').upload(combinedPath, newBuf, { upsert: true, contentType: mimeType || 'application/octet-stream' })
      console.log('[chunk] updated combined', {
        sessionId,
        combinedPath,
        prevBytes: existingBuf ? existingBuf.byteLength : 0,
        appendedBytes: buffer.byteLength,
        totalBytes: newBuf.byteLength
      })
    } catch (appendErr) {
      console.warn('append combined failed', appendErr?.message)
    }

    // Optional: quick live caption disabled for 5s chunks to save quota
    const liveText = ''

    return NextResponse.json({ ok: true, text: liveText || undefined })
  } catch (e) {
    return NextResponse.json({ message: 'Chunk upload failed', details: e?.message }, { status: 500 })
  }
}


