import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'
import { SpeechClient } from '@google-cloud/speech'
import fs from 'node:fs'
import { syncGoogleCalendarForOrg, shouldSyncForOrg } from '@/server/integrations/google-calendar-sync'
import { embedTexts } from '@/server/ai/embedding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSpeechClient() {
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  // Mode A: JSON string in env
  if (gac.trim().startsWith('{')) {
    try {
      const json = JSON.parse(gac)
      const projectId = json.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
      if (!json.client_email || !json.private_key) {
        throw new Error('Missing client_email or private_key in GOOGLE_APPLICATION_CREDENTIALS JSON')
      }
      console.log('[speech] using credentials from JSON in GOOGLE_APPLICATION_CREDENTIALS')
      return new SpeechClient({ projectId, credentials: { client_email: json.client_email, private_key: json.private_key } })
    } catch (e) {
      console.error('[speech] Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON:', e?.message)
      throw e
    }
  }
  // Mode B: path on disk
  if (gac) {
    if (!fs.existsSync(gac)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS path does not exist: ${gac}`)
    }
    console.log('[speech] using credentials from path in GOOGLE_APPLICATION_CREDENTIALS')
    return new SpeechClient()
  }
  // Mode C: ADC (gcloud or metadata)
  console.log('[speech] using Application Default Credentials (no GOOGLE_APPLICATION_CREDENTIALS provided)')
  return new SpeechClient()
}

export async function POST(request) {
  console.log('🚨 [transcribe] API HIT! Request received')
  try {
    // Require auth (user session or device key)
    let supabase = await createAuthClient()
    let { data, error } = await supabase.auth.getUser()
    console.log('🔐 [transcribe] Auth check:', { hasUser: !!data?.user, error: error?.message })

    let deviceMode = false
    let deviceUserId = null
    let deviceOrgId = null

    if (error || !data?.user) {
      // Attempt device key auth
      const authHeader = request.headers.get('authorization') || ''
      const bearer = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : ''
      const headerKey = request.headers.get('x-device-key') || ''
      const deviceKey = bearer || headerKey
      if (!deviceKey) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
      }

      // Look up device key in DB
      const svc = createServiceClient()
      const { data: deviceRow, error: deviceErr } = await svc
        .from('device_api_keys')
        .select('user_id, organization_id, active')
        .eq('key', deviceKey)
        .maybeSingle()

      if (deviceErr || !deviceRow || deviceRow.active === false) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
      }

      deviceMode = true
      deviceUserId = deviceRow.user_id
      deviceOrgId = deviceRow.organization_id
      supabase = svc
      // Best-effort update last_used_at
      svc.from('device_api_keys').update({ last_used_at: new Date().toISOString() }).eq('key', deviceKey).then(() => { }).catch(() => { })
      console.log('🔑 [transcribe] Device key auth accepted and mapped to user/org')
    }

    // Process audio chunk and save to daily session
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ message: 'Expected multipart/form-data' }, { status: 400 })
    }
    const form = await request.formData()
    const mode = form.get('mode') || 'cloud'
    const file = form.get('chunk')
    const browserText = form.get('text')
    const browserTranscript = (mode === 'browser' && typeof browserText === 'string' && browserText.trim()) ? browserText.trim() : null
    // Only require audio when we don't have a browser-provided transcript
    if (!browserTranscript && (!file || typeof file === 'string')) {
      return NextResponse.json({ message: 'Missing audio chunk' }, { status: 400 })
    }

    let transcript = ''
    if (browserTranscript) {
      transcript = browserTranscript
      console.log('[transcribe] using browser-provided transcript', { chars: transcript.length })
    } else {
      const mimeType = form.get('mimeType') || ''
      const arrayBuffer = await file.arrayBuffer()
      const audioBuffer = Buffer.from(arrayBuffer)
      const sig4 = audioBuffer.subarray(0, 4)
      const sigHex = sig4.toString('hex')
      const sigAscii = (() => {
        try { return audioBuffer.subarray(0, 4).toString('utf8') } catch { return '' }
      })()
      console.log('🎤 [transcribe] processing chunk', {
        bytes: audioBuffer.byteLength,
        mimeType,
        sigHex,
        sigAscii
      })

      try {
        const speech = getSpeechClient()
        // Choose encoding based on header sniffing first, then mimeType
        const isOgg = sigAscii === 'OggS'
        const isWebm = sig4.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
        const isRiff = sigAscii === 'RIFF'
        let encoding = 'ENCODING_UNSPECIFIED'
        if (isOgg || String(mimeType).includes('ogg')) encoding = 'OGG_OPUS'
        else if (isWebm || String(mimeType).includes('webm')) encoding = 'WEBM_OPUS'
        else if (isRiff || String(mimeType).includes('wav')) encoding = 'LINEAR16'

        async function recognizeOnce(enc) {
          let sampleRateHertz = undefined
          if (enc === 'OGG_OPUS' || enc === 'WEBM_OPUS') sampleRateHertz = 48000
          if (enc === 'LINEAR16') {
            // Try to parse WAV sample rate from header if present at byte offset 24
            try {
              const dv = new DataView(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength)
              const sr = dv.getUint32(24, true)
              if (sr > 0 && sr < 200000) sampleRateHertz = sr
            } catch { }
            if (!sampleRateHertz) sampleRateHertz = 16000
          }
          const [r] = await speech.recognize({
            config: {
              languageCode: 'en-US',
              enableAutomaticPunctuation: true,
              maxAlternatives: 1,
              encoding: enc,
              ...(sampleRateHertz ? { sampleRateHertz } : {}),
            },
            audio: { content: audioBuffer.toString('base64') },
          })
          return r
        }

        let resp = await recognizeOnce(encoding)
        // Fallback: if empty and encoding was unspecified, try both
        if ((!resp?.results || resp.results.length === 0) && encoding === 'ENCODING_UNSPECIFIED') {
          try { resp = await recognizeOnce('OGG_OPUS') } catch { }
          if (!resp?.results || resp.results.length === 0) {
            try { resp = await recognizeOnce('WEBM_OPUS') } catch { }
          }
        }
        const results = resp?.results || []
        transcript = results.map(r => r.alternatives?.[0]?.transcript || '').filter(Boolean).join(' ').trim()
        if (!transcript) {
          console.log('[transcribe] empty result', { resultCount: results.length })
        }
        console.log('[transcribe] transcription result', { chars: transcript.length })
      } catch (e) {
        console.error('[transcribe] error', e?.code, e?.message, e?.details)

        // Provide more specific error messages
        let errorMessage = 'Recognition failed'
        let statusCode = 500

        if (e?.message?.includes('invalid_grant') || e?.message?.includes('invalid_rapt')) {
          errorMessage = 'Google Cloud authentication failed. Please check service account credentials.'
          statusCode = 401
        } else if (e?.message?.includes('not found') || e?.code === 5) {
          errorMessage = 'Google Cloud Speech API not found or not enabled'
          statusCode = 503
        } else if (e?.message?.includes('permission') || e?.code === 7) {
          errorMessage = 'Insufficient permissions for Google Cloud Speech API'
          statusCode = 403
        }

        return NextResponse.json({
          message: errorMessage,
          details: e?.message,
          code: e?.code
        }, { status: statusCode })
      }
    }

    // Daily session approach - create/find today's session for the user
    try {
      const userId = deviceMode ? deviceUserId : data.user.id

      // Get user's organization - they MUST have one  
      let orgId = deviceOrgId || null
      if (!orgId) {
        const { data: orgRow, error: orgError } = await supabase
          .from('org_members')
          .select('organization_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle()

        console.log('[transcribe] Organization lookup result:', { orgRow, orgError, userId })

        if (!orgRow?.organization_id) {
          console.error('[transcribe] User has no organization:', userId)
          throw new Error('User must belong to an organization')
        }

        orgId = orgRow.organization_id
      }

      // Optionally trigger background Google Calendar sync (hourly throttle)
      try {
        const shouldSync = await shouldSyncForOrg(orgId, 60 * 60 * 1000)
        if (shouldSync) {
          // Fire-and-forget, do not await
          syncGoogleCalendarForOrg({ organizationId: orgId }).catch(() => { })
        }
      } catch (_) { }

      // Find or create today's session for this user
      const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
      const todayStart = new Date(today + 'T00:00:00.000Z')
      const todayEnd = new Date(today + 'T23:59:59.999Z')

      let { data: todaySession } = await supabase
        .from('sessions')
        .select('id, title')
        .eq('organization_id', orgId)
        .eq('created_by', userId)
        .gte('created_at', todayStart.toISOString())
        .lte('created_at', todayEnd.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!todaySession) {
        console.log('[transcribe] Creating daily session for', today)
        const sessionTitle = `Conversations - ${today}`
        const { data: inserted, error: insertError } = await supabase
          .from('sessions')
          .insert({
            organization_id: orgId,
            created_by: userId,
            title: sessionTitle,
            status: 'transcribing',
            started_at: todayStart.toISOString()
          })
          .select('id, title')
          .single()

        if (insertError) {
          console.error('[transcribe] Daily session creation failed:', insertError)
          throw insertError
        } else {
          todaySession = inserted
          console.log('[transcribe] Daily session created:', todaySession)
        }
      } else {
        console.log('[transcribe] Using existing daily session:', todaySession)
      }

      // Only save transcript if we have content
      if (transcript) {
        const timestamp = new Date().toISOString()

        // Determine transcript file path: transcripts/<org>/<session_id>.txt
        // Fallback to transcripts/<org>/<userId>-<date>.txt if session missing
        const today = new Date().toISOString().split('T')[0]
        const transcriptPath = `transcripts/${orgId}/${todaySession?.id || `${userId}-${today}`}.txt`

        // Use service client for storage to avoid RLS issues
        const svc = createServiceClient()

        // Download existing content (if any)
        let existingText = ''
        try {
          const { data: fileData, error: downloadError } = await svc.storage
            .from('copilot.sh')
            .download(transcriptPath)
          if (downloadError) {
            console.log('[transcribe] No existing transcript file, will create new:', transcriptPath, downloadError?.message)
          } else if (fileData) {
            existingText = await fileData.text()
          }
        } catch (downloadErr) {
          console.log('[transcribe] Transcript download skipped:', downloadErr?.message)
        }

        // Simple deduplication: avoid appending if the last slice already contains the new text
        let shouldAppend = true
        if (existingText) {
          const recentSlice = existingText.slice(-500).toLowerCase()
          const currentText = transcript.toLowerCase()
          if (recentSlice.includes(currentText)) {
            console.log('🔄 [transcribe] Skipping duplicate/overlapping content in storage:', transcript)
            shouldAppend = false
          }
        }

        if (shouldAppend) {
          // Append as single-line entry with timestamp delimiter and no extra blank lines
          const entry = `_TIMESTAMP_${timestamp}|${transcript}\n`
          const newText = existingText ? `${existingText}${entry}` : entry
          const buffer = Buffer.from(newText, 'utf8')

          const { error: uploadError } = await svc.storage
            .from('copilot.sh')
            .upload(transcriptPath, buffer, {
              upsert: true,
              contentType: 'text/plain; charset=utf-8'
            })

          if (uploadError) {
            console.error('❌ [transcribe] Failed to upload transcript to storage:', uploadError)
          } else {
            console.log('✅ [transcribe] Appended transcript to storage file:', transcriptPath)

            // Update session with transcript storage path
            try {
              await supabase
                .from('sessions')
                .update({ transcript_storage_path: transcriptPath })
                .eq('id', todaySession.id)
              console.log('✅ [transcribe] Updated session with transcript path')
            } catch (pathError) {
              console.warn('❌ [transcribe] Failed to update session with transcript path:', pathError)
            }
          }
        }

        // Also persist a searchable chunk with embedding
        try {
          const [embedding] = await embedTexts([transcript])
          if (Array.isArray(embedding) && embedding.length > 0 && todaySession?.id) {
            const { error: chunkError } = await supabase
              .from('session_chunks')
              .insert({
                session_id: todaySession.id,
                content: transcript,
                start_time_seconds: null,
                end_time_seconds: null,
                speaker_tag: null,
                embedding
              })
            if (chunkError) {
              console.error('❌ [transcribe] Failed to insert session chunk:', chunkError)
            } else {
              console.log('✅ [transcribe] Inserted session chunk with embedding')
            }
          }
        } catch (embedErr) {
          console.error('❌ [transcribe] Embedding/chunk insert failed:', embedErr?.message)
        }
      } else {
        console.log('[transcribe] No transcript text from recognizer; nothing to append')
      }
    } catch (e) {
      console.error('[transcribe] persist failed', e?.message)
    }

    return NextResponse.json({ text: transcript })
  } catch (err) {
    console.error('[transcribe] main error', err?.message)
    return NextResponse.json({ message: 'Transcription failed', details: err?.message }, { status: 500 })
  }
}