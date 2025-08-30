import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sniffExt(mime, bytes) {
  console.log('[sniffExt] input', { mime, bytesLength: bytes?.length })
  try {
    const buf = Buffer.from(bytes)
    const sig4 = buf.subarray(0, 4)
    const sig12 = buf.subarray(0, 12)
    const ascii4 = (() => { try { return sig4.toString('utf8') } catch { return '' } })()
    const ascii12 = (() => { try { return sig12.toString('utf8') } catch { return '' } })()

    const m = String(mime).toLowerCase()
    console.log('[sniffExt] normalized mime', { original: mime, normalized: m })

    // Check mime type first for common audio formats
    if (m.includes('ogg')) {
      console.log('[sniffExt] matched ogg via mime')
      return 'ogg'
    }
    if (m.includes('webm')) {
      console.log('[sniffExt] matched webm via mime')
      return 'webm'
    }
    if (m.includes('m4a') || m.includes('mp4') || m.includes('aac') || m === 'audio/x-m4a') {
      console.log('[sniffExt] matched m4a via mime', { includes_m4a: m.includes('m4a'), includes_mp4: m.includes('mp4'), includes_aac: m.includes('aac'), exact_match: m === 'audio/x-m4a' })
      return 'm4a'
    }
    if (m.includes('wav')) {
      console.log('[sniffExt] matched wav via mime')
      return 'wav'
    }
    if (m.includes('flac')) {
      console.log('[sniffExt] matched flac via mime')
      return 'flac'
    }
    if (m.includes('mp3')) {
      console.log('[sniffExt] matched mp3 via mime')
      return 'mp3'
    }
    // audio/mpeg is ambiguous - let binary detection decide

    console.log('[sniffExt] no mime match, trying binary detection', { ascii4, ascii12, sig4_hex: sig4.toString('hex') })

    // Fallback to binary signature detection
    // OGG
    if (ascii4 === 'OggS') {
      console.log('[sniffExt] matched ogg via binary')
      return 'ogg'
    }

    // WEBM / Matroska
    if (sig4.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      console.log('[sniffExt] matched webm via binary')
      return 'webm'
    }

    // M4A / MP4-based
    // Typical MP4/M4A starts with 4-byte length then 'ftyp' brand
    if (ascii12.includes('ftyp')) {
      console.log('[sniffExt] matched m4a via binary ftyp')
      return 'm4a'
    }

    // WAV
    // 'RIFF'....'WAVE'
    const ascii12b = ascii12
    if (ascii4 === 'RIFF' && ascii12b.includes('WAVE')) {
      console.log('[sniffExt] matched wav via binary')
      return 'wav'
    }

    // FLAC
    if (ascii4 === 'fLaC') {
      console.log('[sniffExt] matched flac via binary')
      return 'flac'
    }

    // MP3
    if (sig4[0] === 0xFF && (sig4[1] & 0xE0) === 0xE0) {
      console.log('[sniffExt] matched mp3 via binary')
      return 'mp3'
    }

    console.log('[sniffExt] no matches, falling back to bin')
  } catch (e) {
    console.log('[sniffExt] error', e?.message)
  }
  // Fallback - should rarely happen with proper mime types
  return 'bin'
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
    console.log('[chunk] extension detection', { mimeType, detectedExt: ext, bufferStart: buffer.subarray(0, 16).toString('hex') })

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


