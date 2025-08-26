import { NextResponse } from 'next/server'
import { createAuthClient } from '@/utils/supabase/server'
import { SpeechClient } from '@google-cloud/speech'

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
    const file = form.get('chunk')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ message: 'Missing audio chunk' }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)
    console.log('🎤 [transcribe] processing chunk', {
      bytes: audioBuffer.byteLength
    })

    try {
      const speech = new SpeechClient()
      const [resp] = await speech.recognize({
        config: {
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          maxAlternatives: 1,
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          model: 'latest_short',
        },
        audio: { content: audioBuffer.toString('base64') },
      })
      const results = resp.results || []
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

          // Get existing transcript to append to
          const { data: existingTranscript } = await supabase
            .from('session_transcripts')
            .select('text, segments_json')
            .eq('session_id', todaySession.id)
            .maybeSingle()

          const existingText = existingTranscript?.text || ''
          const existingSegments = Array.isArray(existingTranscript?.segments_json) ? existingTranscript.segments_json : []

          // Simple deduplication: check if this transcript is very similar to recent content
          let shouldAppend = true
          if (existingText) {
            const recentSlice = existingText.slice(-500).toLowerCase()
            const currentText = transcript.toLowerCase()
            if (recentSlice.includes(currentText)) {
              console.log('🔄 [transcribe] Skipping duplicate/overlapping content:', transcript)
              shouldAppend = false
            }
          }

          if (shouldAppend) {
            const newText = existingText ? `${existingText}\n\n${transcript}` : transcript
            const newSegments = [...existingSegments, { ts: timestamp, text: transcript }]

            // Insert structured segment
            await supabase
              .from('transcript_segments')
              .insert({ session_id: todaySession.id, ts: timestamp, text: transcript })

            // Upsert the aggregate transcript
            await supabase
              .from('session_transcripts')
              .upsert({
                session_id: todaySession.id,
                text: newText,
                segments_json: newSegments,
                words_json: null
              }, { onConflict: 'session_id' })

            console.log('✅ [transcribe] Appended transcript to daily session:', todaySession.id)
          }
        } else {
          console.log('[transcribe] No transcript to save for daily session:', todaySession.id)
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