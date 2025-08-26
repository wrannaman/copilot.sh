import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'
import { SpeechClient } from '@google-cloud/speech'
import { syncGoogleCalendarForOrg, shouldSyncForOrg } from '@/server/integrations/google-calendar-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  console.log('🚨 [transcribe] API HIT! Request received')
  try {
    // Require auth
    const supabase = await createAuthClient()
    const { data, error } = await supabase.auth.getUser()
    console.log('🔐 [transcribe] Auth check:', { hasUser: !!data?.user, error: error?.message })
    if (error || !data?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
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
    if (mode === 'browser' && typeof browserText === 'string' && browserText.trim()) {
      // Short-circuit: trust browser-provided text
      const transcript = browserText.trim()
      return NextResponse.json({ text: transcript })
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ message: 'Missing audio chunk' }, { status: 400 })
    }
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
      const speech = new SpeechClient()
      // Choose encoding based on header sniffing first, then mimeType
      const isOgg = sigAscii === 'OggS'
      const isWebm = sig4.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      let encoding = 'ENCODING_UNSPECIFIED'
      if (isOgg || String(mimeType).includes('ogg')) encoding = 'OGG_OPUS'
      else if (isWebm || String(mimeType).includes('webm')) encoding = 'WEBM_OPUS'

      async function recognizeOnce(enc) {
        const [r] = await speech.recognize({
          config: {
            languageCode: 'en-US',
            enableAutomaticPunctuation: true,
            maxAlternatives: 1,
            encoding: enc,
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
      const transcript = results.map(r => r.alternatives?.[0]?.transcript || '').filter(Boolean).join(' ').trim()
      if (!transcript) {
        console.log('[transcribe] empty result', { resultCount: results.length })
      }
      console.log('[transcribe] transcription result', { chars: transcript.length })

      // Daily session approach - create/find today's session for the user
      try {
        const userId = data.user.id

        // Get user's organization - they MUST have one  
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

        const orgId = orgRow.organization_id

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
            }
          }
        } else {
          console.log('[transcribe] No transcript text from recognizer; nothing to append')
        }
      } catch (e) {
        console.error('[transcribe] persist failed', e?.message)
      }

      return NextResponse.json({ text: transcript })
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
  } catch (err) {
    console.error('[transcribe] main error', err?.message)
    return NextResponse.json({ message: 'Transcription failed', details: err?.message }, { status: 500 })
  }
}