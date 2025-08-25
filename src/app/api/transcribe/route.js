import { NextResponse } from 'next/server'
import { createAuthClient, createClient as createServiceClient } from '@/utils/supabase/server'
import { SpeechClient } from '@google-cloud/speech'
import { embedTexts } from '@/server/ai/embedding'

// In-memory streaming sessions (per server instance)
const activeSessions = new Map()

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    // Require auth
    const supabase = await createAuthClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'chunk'
    const sessionIdParam = url.searchParams.get('sessionId') || ''
    const mode = url.searchParams.get('mode') || 'stateful'

    // Start a streaming session
    if (action === 'start') {
      const sessionId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
      const speech = new SpeechClient()
      const requestConfig = {
        config: {
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          maxAlternatives: 1,
          diarizationConfig: {
            enableSpeakerDiarization: true,
            minSpeakerCount: 2,
            maxSpeakerCount: 6,
          },
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          model: 'latest_short',
        },
        interimResults: true,
        singleUtterance: false,
      }

      const stream = speech.streamingRecognize(requestConfig)
      const session = { stream, lastText: '', lastWords: [], error: null, ended: false, dbSessionId: null }
      activeSessions.set(sessionId, session)
      console.log('[transcribe] start', { sessionId })

      stream.on('data', (data) => {
        try {
          const results = data.results || []
          const first = results[0]
          const alt = first?.alternatives?.[0]
          const transcript = alt?.transcript || ''
          const isFinal = Boolean(first?.isFinal)
          console.log('[transcribe] data', { chars: transcript.length, isFinal })
          if (alt) {
            session.lastText = transcript
            session.lastWords = (alt.words || []).map((w) => ({
              word: w.word,
              startTime: Number(w.startTime?.seconds || 0) + (Number(w.startTime?.nanos || 0) / 1e9),
              endTime: Number(w.endTime?.seconds || 0) + (Number(w.endTime?.nanos || 0) / 1e9),
              speakerTag: w.speakerTag || null,
            }))
          }
        } catch (e) {
          console.warn('[transcribe] data parse error', e?.message)
        }
      })
      stream.on('error', (err) => { session.error = err?.message || 'stream error'; console.error('[transcribe] stream error', err?.message) })
      stream.on('end', () => { session.ended = true; console.log('[transcribe] stream end') })

      // Create DB session row for this stream so we can save when ending
      try {
        const service = await createServiceClient()
        const userId = data.user.id

        // Get user's organization - they MUST have one
        const { data: orgRow } = await service
          .from('org_members')
          .select('organization_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle()

        if (!orgRow?.organization_id) {
          console.error('[transcribe] User has no organization:', userId)
          throw new Error('User must belong to an organization')
        }

        const orgId = orgRow.organization_id
        const { data: created } = await service
          .from('sessions')
          .insert({ organization_id: orgId, created_by: userId, status: 'transcribing' })
          .select('id')
          .single()

        if (created?.id) {
          session.dbSessionId = created.id
          console.log('[transcribe] Created session:', created.id, 'for org:', orgId)
        } else {
          throw new Error('Failed to create session')
        }
      } catch (e) {
        console.error('[transcribe] Failed to create session:', e?.message)
      }

      return NextResponse.json({ sessionId, dbSessionId: session.dbSessionId })
    }

    // Write a chunk to an existing session
    if (action === 'chunk') {
      // Stateless recognition: handle each chunk independently (no active session)
      if (mode === 'stateless' || !sessionIdParam) {
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
        console.log('[transcribe] stateless chunk', { bytes: audioBuffer.byteLength })
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
            console.log('[transcribe] stateless empty', { resultCount: results.length })
          }
          console.log('[transcribe] stateless respond', { chars: transcript.length })

          // Optional persistence: client-provided session identifier
          const clientSessionId = (new URL(request.url)).searchParams.get('clientSessionId') || ''
          if (clientSessionId && transcript) {
            try {
              const service = await createServiceClient()
              const userId = data.user.id

              // Get user's organization - they MUST have one
              const { data: orgRow } = await service
                .from('org_members')
                .select('organization_id')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle()

              if (!orgRow?.organization_id) {
                console.error('[transcribe] stateless: User has no organization:', userId)
                throw new Error('User must belong to an organization')
              }

              const orgId = orgRow.organization_id

              // Ensure session exists with provided id
              const { data: existing } = await service
                .from('sessions')
                .select('id')
                .eq('id', clientSessionId)
                .maybeSingle()

              if (!existing) {
                console.log('[transcribe] stateless: Creating session', clientSessionId, 'for org:', orgId)
                await service
                  .from('sessions')
                  .insert({ id: clientSessionId, organization_id: orgId, created_by: userId, status: 'transcribing' })
              }

              // Determine next chunk index
              const { data: lastChunk } = await service
                .from('session_chunks')
                .select('chunk_index')
                .eq('session_id', clientSessionId)
                .order('chunk_index', { ascending: false })
                .limit(1)
                .maybeSingle()
              const nextIndex = (lastChunk?.chunk_index ?? -1) + 1

              // Embed and store
              const [emb] = await embedTexts([transcript])
              await service.from('session_chunks').insert({
                session_id: clientSessionId,
                chunk_index: nextIndex,
                content: transcript,
                embedding: emb || null,
              })

              console.log('[transcribe] stateless: Saved chunk', nextIndex, 'for session:', clientSessionId)
            } catch (e) {
              console.error('[transcribe] stateless persist failed', e?.message)
            }
          }

          return NextResponse.json({ text: transcript })
        } catch (e) {
          console.error('[transcribe] stateless error', e?.message)
          return NextResponse.json({ message: 'Recognition failed', details: e?.message }, { status: 500 })
        }
      }

      const sessionId = sessionIdParam
      const session = activeSessions.get(sessionId)
      if (!session) {
        console.warn('[transcribe] chunk for missing session', { sessionId })
        return NextResponse.json({ message: 'Invalid sessionId' }, { status: 400 })
      }

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
      console.log('[transcribe] chunk', { sessionId, bytes: arrayBuffer.byteLength })

      try {
        // IMPORTANT: field name must be camelCase `audioContent` for the Node client
        session.stream.write({ audioContent: Buffer.from(arrayBuffer) })
      } catch (e) {
        console.error('[transcribe] write failed', e?.message)
        session.ended = true
        try { session.stream.end() } catch { }
        activeSessions.delete(sessionId)
        return NextResponse.json({ message: 'Stream closed', details: e?.message }, { status: 410 })
      }
      const payload = { text: session.lastText || '', words: session.lastWords || [] }
      console.log('[transcribe] respond chunk', { chars: (payload.text || '').length })
      return NextResponse.json(payload)
    }

    // End an existing session
    if (action === 'end') {
      const sessionId = sessionIdParam
      const session = activeSessions.get(sessionId)
      if (!session) return NextResponse.json({ message: 'Invalid sessionId' }, { status: 400 })
      try { session.stream.end() } catch { }
      const result = { text: session.lastText || '', words: session.lastWords || [] }
      // Persist on end
      if (session.dbSessionId) {
        try {
          const service = await createServiceClient()
          const wordsJson = Array.isArray(result.words) ? result.words : []
          await service
            .from('session_transcripts')
            .upsert({ session_id: session.dbSessionId, text: result.text, words_json: wordsJson }, { onConflict: 'session_id' })
          // naive sentence chunks
          const sentences = (result.text || '').split(/(?<=[.!?])\s+/).filter(Boolean)
          let chunkIndex = 0
          for (const sentence of sentences) {
            const [emb] = await embedTexts([sentence])
            await service.from('session_chunks').insert({
              session_id: session.dbSessionId,
              chunk_index: chunkIndex++,
              content: sentence,
              embedding: emb || null,
            })
          }
          await service
            .from('sessions')
            .update({ status: 'ready' })
            .eq('id', session.dbSessionId)
        } catch { }
      }
      activeSessions.delete(sessionId)
      return NextResponse.json(result)
    }

    // Finalize a stateless session: stitch chunks and mark ready
    if (action === 'finalize' && (mode === 'stateless' || !sessionIdParam)) {
      const clientSessionId = (new URL(request.url)).searchParams.get('clientSessionId') || ''
      if (!clientSessionId) {
        return NextResponse.json({ message: 'clientSessionId required' }, { status: 400 })
      }
      try {
        const service = await createServiceClient()
        const userId = data.user.id

        // Verify user owns this session through organization membership
        const { data: sessionCheck } = await service
          .from('sessions')
          .select(`id, organization_id`)
          .eq('id', clientSessionId)
          .maybeSingle()
        // Additional access check via membership
        const { data: membership } = await service
          .from('org_members')
          .select('organization_id')
          .eq('organization_id', sessionCheck?.organization_id || '00000000-0000-0000-0000-000000000000')
          .eq('user_id', userId)
          .maybeSingle()

        if (!sessionCheck || !membership) {
          console.error('[transcribe] finalize: Session not found or not owned by user:', clientSessionId, userId)
          return NextResponse.json({ message: 'Session not found or access denied' }, { status: 404 })
        }

        const { data: chunks } = await service
          .from('session_chunks')
          .select('content, chunk_index')
          .eq('session_id', clientSessionId)
          .order('chunk_index', { ascending: true })

        const full = (chunks || []).map(c => c.content || '').join(' ').trim()
        console.log('[transcribe] finalize: Stitching', chunks?.length || 0, 'chunks into full transcript')

        await service
          .from('session_transcripts')
          .upsert({ session_id: clientSessionId, text: full, words_json: [] }, { onConflict: 'session_id' })

        await service
          .from('sessions')
          .update({ status: 'ready', ended_at: new Date().toISOString() })
          .eq('id', clientSessionId)

        console.log('[transcribe] finalize: Session', clientSessionId, 'marked as ready')
        return NextResponse.json({ text: full })
      } catch (e) {
        console.error('[transcribe] finalize stateless failed', e?.message)
        return NextResponse.json({ message: 'Finalize failed', details: e?.message }, { status: 500 })
      }
    }

    return NextResponse.json({ message: 'Unsupported action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ message: 'Transcription failed', details: err?.message }, { status: 500 })
  }
}

// SSE stream of incremental results for a session
export async function GET(request) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId') || ''
  if (!sessionId) {
    return NextResponse.json({ message: 'sessionId required' }, { status: 400 })
  }
  const session = activeSessions.get(sessionId)
  if (!session) {
    return NextResponse.json({ message: 'Invalid sessionId' }, { status: 404 })
  }

  let intervalId
  let lastSentText = ''
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      intervalId = setInterval(() => {
        const s = activeSessions.get(sessionId)
        if (!s) {
          send({ type: 'end' })
          clearInterval(intervalId)
          controller.close()
          return
        }
        if (s.error) {
          send({ type: 'error', error: s.error })
          clearInterval(intervalId)
          controller.close()
          return
        }
        if (s.lastText !== lastSentText) {
          lastSentText = s.lastText
          send({ type: 'update', text: s.lastText, words: s.lastWords })
        }
        if (s.ended) {
          send({ type: 'end', text: s.lastText })
          clearInterval(intervalId)
          controller.close()
        }
      }, 1000)
    },
    cancel() {
      if (intervalId) clearInterval(intervalId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}


