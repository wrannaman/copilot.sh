import dotenv from 'dotenv'
dotenv.config()

import { loadCombinedOrConcat, transcribeWhole, transcribeWithWhisperX } from './lib/audio.js'
import { supabaseService, uploadText, updateSession, uploadAudioToGCS, deleteFromGCS } from './lib/services.js'
import { embedTexts } from './lib/embedding.js'
import { processAndChunkTranscript } from './lib/chunks.js'
import { summarizeTranscript } from './lib/summarize.js'
import { SpeechClient } from '@google-cloud/speech'

function getSpeechClient() {
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  if (gac.trim().startsWith('{')) {
    try {
      const json = JSON.parse(gac)
      const projectId = json.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
      if (!json.client_email || !json.private_key) throw new Error('missing SA fields')
      return new SpeechClient({ projectId, credentials: { client_email: json.client_email, private_key: json.private_key } })
    } catch (e) {
      console.error('GAC parse failed', e?.message)
    }
  }
  return new SpeechClient()
}

// Canonical finalization: save transcript + raw results, chunk + embed, summarize + embed, update session
async function finalizeTranscription({ sessionId, organizationId, text, results }) {
  const bucket = 'copilot.sh'
  console.log('[finalize] begin', { sessionId, hasResults: Array.isArray(results), textLength: (text || '').length })

  // Store transcript
  const transcriptPath = `transcripts/${organizationId}/${sessionId}.txt`
  const entry = `_TIMESTAMP_${new Date().toISOString()}|${text || ''}\n`
  await uploadText(bucket, transcriptPath, entry)

  // Log signed URL for human-readable transcript
  try {
    const supa = supabaseService()
    const expiresIn = Number(process.env.SIGNED_URL_EXPIRES || 3600)
    const { data: tSigned } = await supa.storage.from(bucket).createSignedUrl(transcriptPath, expiresIn)
    if (tSigned?.signedUrl) {
      console.log(`[finalize] Signed URL (Google transcript .txt, ${expiresIn}s):`, tSigned.signedUrl)
    }
  } catch (e) {
    console.warn('[finalize] failed to create signed URL for transcript', e?.message)
  }

  // Store RAW Google results array exactly as returned
  const rawResultsPath = `transcripts/${organizationId}/${sessionId}.raw.json`
  const rawArray = Array.isArray(results) ? results : (results?.results || [])
  await uploadText(bucket, rawResultsPath, JSON.stringify(rawArray, null, 2), 'application/json')

  // Log signed URL for RAW results JSON
  try {
    const supa = supabaseService()
    const expiresIn = Number(process.env.SIGNED_URL_EXPIRES || 3600)
    const { data: rSigned } = await supa.storage.from(bucket).createSignedUrl(rawResultsPath, expiresIn)
    if (rSigned?.signedUrl) {
      console.log(`[finalize] Signed URL (Google raw JSON, ${expiresIn}s):`, rSigned.signedUrl)
    }
  } catch (e) {
    console.warn('[finalize] failed to create signed URL for raw results', e?.message)
  }

  await updateSession(sessionId, {
    transcript_storage_path: transcriptPath,
    raw_transcript_path: rawResultsPath
  })

  // Chunking + embeddings in parallel with summarization
  const chunkingPromise = processAndChunkTranscript(sessionId, results)
    .catch(e => console.warn('[finalize] chunking failed', e?.message))

  try {
    try { await updateSession(sessionId, { status: 'summarizing' }) } catch { }
    // Fetch guidance
    let userPrompt = ''
    let orgPrompt = ''
    let orgTopics = []
    let orgActionItems = []
    try {
      const supa = supabaseService()
      const { data: row } = await supa.from('sessions').select('summary_prompt').eq('id', sessionId).maybeSingle()
      userPrompt = (row?.summary_prompt || '').toString()
    } catch { }
    try {
      const supa = supabaseService()
      const { data: org } = await supa.from('org').select('settings').eq('id', organizationId).maybeSingle()
      if (org?.settings?.summary_prefs?.prompt) orgPrompt = String(org.settings.summary_prefs.prompt)
      if (Array.isArray(org?.settings?.summary_prefs?.topics)) orgTopics = org.settings.summary_prefs.topics
      if (Array.isArray(org?.settings?.summary_prefs?.action_items)) orgActionItems = org.settings.summary_prefs.action_items
    } catch { }

    const plain = (entry || '')
      .split('\n')
      .map(line => {
        if (line.startsWith('_TIMESTAMP_')) {
          const idx = line.indexOf('|'); return idx > -1 ? line.slice(idx + 1) : line
        }
        return line
      })
      .join('\n')
      .trim()

    const guidanceParts = []
    if (orgPrompt && orgPrompt.trim()) guidanceParts.push(orgPrompt.trim())
    if (userPrompt && userPrompt.trim()) guidanceParts.push(userPrompt.trim())
    if (orgTopics.length) guidanceParts.push(`Emphasize these topics: ${orgTopics.join(', ')}`)
    if (orgActionItems.length) guidanceParts.push(`Prioritize action items related to: ${orgActionItems.join(', ')}`)
    const instructions = guidanceParts.join('\n')

    const object = await summarizeTranscript(plain, instructions)
    const sumPath = `summaries/${organizationId}/${sessionId}.json`
    await uploadText(bucket, sumPath, JSON.stringify(object, null, 2), 'application/json')

    let summaryEmbedding = null
    const summaryText = (object?.summary || '').toString()
    if (summaryText && summaryText.trim().length > 0) {
      try {
        const [vec] = await embedTexts([summaryText])
        if (Array.isArray(vec) && vec.length) summaryEmbedding = vec
      } catch (e) {
        console.warn('[finalize] summary embedding failed', e?.message)
      }
    }
    try {
      await updateSession(sessionId, {
        summary_text: summaryText,
        structured_data: {
          action_items: Array.isArray(object?.action_items) ? object.action_items : [],
          topics: Array.isArray(object?.topics) ? object.topics : []
        },
        summary_embedding: summaryEmbedding
      })
    } catch (e) {
      console.warn('[finalize] failed to persist synthesis to sessions table', e?.message)
    }
    console.log('[finalize] summarize done', { sessionId })
  } catch (e) {
    console.warn('[finalize] summarize failed', e?.message)
  }

  try { await chunkingPromise } catch { }
  await updateSession(sessionId, { status: 'ready' })
  console.log('[finalize] complete', { sessionId })
}

async function processSession({ sessionId, organizationId }) {
  const bucket = 'copilot.sh'
  // Load a single combined file if present, otherwise concat the recorded parts
  const audioResult = await loadCombinedOrConcat(bucket, organizationId, sessionId)
  const audioBuf = audioResult.buffer
  const isChunked = audioResult.isChunked
  const chunkCount = audioResult.chunkCount

  // Compute duration from known WAV format (16kHz mono, 16-bit PCM → 32,000 bytes/sec)
  const audioBytes = audioBuf.length
  const audioSizeKB = audioBytes / 1024
  const bytesPerSecond = 16000 * 1 * 2
  const estimatedDurationSeconds = audioBytes / bytesPerSecond
  const estimatedDurationMinutes = estimatedDurationSeconds / 60

  console.log(`[processSession] Audio: ${audioSizeKB.toFixed(1)}KB, ${estimatedDurationSeconds.toFixed(1)}s (${estimatedDurationMinutes.toFixed(2)}min), ${isChunked ? `${chunkCount} chunks` : 'single file'}`)

  // (moved) WhisperX kickoff occurs after GCS job starts

  // ALWAYS use GCS for all recordings - simpler, more reliable, handles any duration
  console.log(`[processSession] Always using GCS for transcription (${isChunked ? `${chunkCount} chunks` : 'single file'})`)

  let gcsFile = null
  let transcriptResults = null
  try {
    const { gcsUri, file } = await uploadAudioToGCS(audioBuf, sessionId, organizationId)
    gcsFile = file
    console.log('[processSession] Uploaded to GCS, starting transcription...')

    // Save GCS info for recovery
    await updateSession(sessionId, {
      gcs_audio_uri: gcsUri
    })

    // Start transcription with callback to save operation name immediately
    console.log(`[processSession] Starting transcription...`)

    const saveOperationName = async (operationName) => {
      console.log(`[processSession] Saving operation name to database: ${operationName}`)
      try {
        await updateSession(sessionId, {
          gcs_operation_name: operationName
        })
        console.log(`[processSession] ✅ Operation name saved for session ${sessionId}`)
      } catch (dbError) {
        console.error(`[processSession] ❌ FAILED to save operation name for session ${sessionId}:`, dbError?.message)
        throw dbError // Let the transcription function know about the error
      }
    }

    const { operationName } = await transcribeWhole(audioBuf, gcsUri, saveOperationName, false)
    console.log('[processSession] Transcription job started', { sessionId, operationName })

    // Kick off WhisperX in parallel now that the GCS job is started
    try {
      console.log('[processSession] Launching WhisperX in parallel...')
      ;(async () => {
        try {
          const res = await transcribeWithWhisperX(audioBuf)
          const whisperxPath = `transcripts/${organizationId}/${sessionId}.whisperx.json`
          await uploadText(bucket, whisperxPath, JSON.stringify(res.json, null, 2), 'application/json')
          console.log('[processSession] WhisperX JSON uploaded', { whisperxPath })
          // Also store a plain-text version for side-by-side comparison
          try {
            const whisperxText = (Array.isArray(res?.json?.segments) ? res.json.segments : []).map(s => s?.text || '').filter(Boolean).join(' ').trim()
            const whisperxTextPath = `transcripts/${organizationId}/${sessionId}.whisperx.txt`
            await uploadText(bucket, whisperxTextPath, whisperxText, 'text/plain; charset=utf-8')
            console.log('[processSession] WhisperX TXT uploaded', { whisperxTextPath })
            const supa = supabaseService()
            const expiresIn = Number(process.env.SIGNED_URL_EXPIRES || 3600)
            const [{ data: jSigned }, { data: tSigned }] = await Promise.all([
              supa.storage.from(bucket).createSignedUrl(whisperxPath, expiresIn),
              supa.storage.from(bucket).createSignedUrl(whisperxTextPath, expiresIn),
            ])
            if (jSigned?.signedUrl) console.log(`[processSession] Signed URL (WhisperX JSON, ${expiresIn}s):`, jSigned.signedUrl)
            if (tSigned?.signedUrl) console.log(`[processSession] Signed URL (WhisperX TXT, ${expiresIn}s):`, tSigned.signedUrl)
          } catch (e) {
            console.warn('[processSession] WhisperX TXT or signed URLs failed', e?.message)
          }
          try {
            await updateSession(sessionId, { whisperx_json_path: whisperxPath })
          } catch (e) {
            console.warn('[processSession] Could not persist whisperx_json_path (add column to sessions)', e?.message)
          }
        } catch (e) {
          console.warn('[processSession] WhisperX failed', e?.message)
        }
      })()
    } catch (e) {
      console.warn('[processSession] WhisperX launch error', e?.message)
    }
    // Do not finalize here; recovery/transcribe loop will complete indexing + embeddings
    return

  } catch (gcsError) {
    console.warn('[processSession] GCS upload failed, falling back to inline:', gcsError.message)
    // Clean up any uploaded file if transcription failed
    if (gcsFile) {
      await deleteFromGCS(gcsFile)
    }
    const { text, results } = await transcribeWhole(audioBuf)
    console.log('[processSession] Inline transcription completed', { sessionId, textLength: (text || '').length, resultsSegments: Array.isArray(results) ? results.length : 0 })
    await finalizeTranscription({ sessionId, organizationId, text, results })
    return
  }
  // Should not reach here; GCS path returns early, inline path finalizes and returns
}

async function checkTranscriptionStatus({ sessionId, organizationId, operationName, gcsUri }) {
  // console.log('[checkTranscription] Checking status', { sessionId, operationName })

  try {
    const speech = getSpeechClient()
    const [op] = await speech.getOperation({ name: operationName })

    // Decode protobuf metadata to show progress
    let progressInfo = ''
    let startTime = null
    let lastUpdateTime = null
    let audioUri = null

    if (op.metadata?.value?.data) {
      const buffer = Buffer.from(op.metadata.value.data)

      // Extract all readable strings from the protobuf
      let allStrings = []
      let currentString = ''

      for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i]
        if (byte >= 32 && byte <= 126) { // Printable ASCII
          currentString += String.fromCharCode(byte)
        } else {
          if (currentString.length > 3) { // Only keep strings longer than 3 chars
            allStrings.push(currentString)
          }
          currentString = ''
        }
      }
      if (currentString.length > 3) {
        allStrings.push(currentString)
      }

      // Find the GCS URI
      audioUri = allStrings.find(s => s.startsWith('gs://'))

      // Try to extract timestamps (protobuf varint encoding)
      // Look for timestamp patterns in the binary data
      for (let i = 0; i < buffer.length - 8; i++) {
        // Check for timestamp-like patterns (big numbers that could be Unix timestamps)
        if (buffer[i] === 0x08) { // Common protobuf field marker
          // Try to read a varint
          let value = 0
          let shift = 0
          for (let j = i + 1; j < Math.min(i + 10, buffer.length); j++) {
            const byte = buffer[j]
            value |= (byte & 0x7F) << shift
            if ((byte & 0x80) === 0) break
            shift += 7
          }

          // If it looks like a timestamp (reasonable year range)
          if (value > 1600000000 && value < 2000000000) {
            const timestamp = new Date(value * 1000)
            if (!startTime || timestamp < startTime) {
              startTime = timestamp
            }
            if (!lastUpdateTime || timestamp > lastUpdateTime) {
              lastUpdateTime = timestamp
            }
          }
        }
      }

      // Build progress info
      let parts = []
      if (audioUri) {
        const filename = audioUri.split('/').pop()
        parts.push(`file: ${filename}`)
      }
      if (startTime) {
        const elapsed = Math.round((Date.now() - startTime.getTime()) / 1000)
        parts.push(`elapsed: ${elapsed}s`)
      }
      if (lastUpdateTime && startTime && lastUpdateTime > startTime) {
        parts.push(`last_update: ${Math.round((Date.now() - lastUpdateTime.getTime()) / 1000)}s ago`)
      }

      progressInfo = parts.length > 0 ? ` (${parts.join(', ')})` : ''

      console.log('[checkTranscription] Raw metadata strings:', allStrings)
    }

    console.log(`[checkTranscription] Operation ${operationName} status: done=${op.done}${progressInfo}`)

    if (op.done) {
      console.log('[checkTranscription] Operation completed, processing results')

      // Use official helper to decode the long-running response
      let results = []
      try {
        const decoded = await getSpeechClient().checkLongRunningRecognizeProgress(operationName)
        // decoded.result should contain LongRunningRecognizeResponse
        const response = decoded?.result || decoded?.latestResponse?.response || decoded
        results = Array.isArray(response?.results) ? response.results : []
        console.log('[checkTranscription] Decoded results segments:', results.length)
      } catch (e) {
        console.error('[checkTranscription] Failed to decode via checkLongRunningRecognizeProgress:', e?.message)
        results = []
      }

      console.log('[checkTranscription] Results', results)

      const text = results.map(r => r.alternatives?.[0]?.transcript || '').filter(Boolean).join(' ').trim()

      console.log("[checkTranscription] text length:", text.length)
      console.log("[checkTranscription] text preview:", text.substring(0, 200) + '...')

      await finalizeTranscription({ sessionId, organizationId, text, results })
      return true
    } else {
      // console.log('[checkTranscription] Operation still running, continuing to wait')
      return false
    }

  } catch (error) {
    console.error('[checkTranscription] Status check failed:', error.message)
    await updateSession(sessionId, {
      status: 'error',
      error_message: `Transcription status check failed: ${error.message}`,
      gcs_operation_name: null,
      gcs_audio_uri: null
    })
    return false
  }
}

// No HTTP server; worker runs as a poller-only process

// Polling model: periodically claim and process sessions in 'uploaded' status
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000)
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 10) // Increased since GCP does the heavy lifting
const runningSessions = new Set()
const transcribingSessions = new Set() // Track sessions waiting for GCP

async function pollAndStart() {
  try {
    const availableSlots = Math.max(0, WORKER_CONCURRENCY - runningSessions.size)
    if (availableSlots <= 0) return
    const supabase = supabaseService()
    const { data: candidates } = await supabase
      .from('sessions')
      .select('id, organization_id')
      .eq('status', 'uploaded')
      .order('created_at', { ascending: true })
      .limit(availableSlots)
    // console.log("🚀 ~ new candidates:", candidates)
    for (const row of (candidates || [])) {
      if (runningSessions.has(row.id)) continue
      // Claim atomically
      console.log(`[main] Claiming session ${row.id} for processing`)
      const { data: claimed, error } = await supabase
        .from('sessions')
        .update({ status: 'transcribing' })
        .eq('id', row.id)
        .eq('status', 'uploaded')
        .select('id')
      if (error) {
        console.log(`[main] Failed to claim session ${row.id}:`, error?.message)
        continue
      }
      if (!claimed || claimed.length === 0) {
        console.log(`[main] Session ${row.id} already claimed by another worker`)
        continue
      }
      console.log(`[main] ✅ Successfully claimed session ${row.id} - status now 'transcribing'`)
      runningSessions.add(row.id)
        ; (async () => {
          try {
            await processSession({ sessionId: row.id, organizationId: row.organization_id })
          } catch (e) {
            try { await updateSession(row.id, { status: 'error', error_message: e?.message || 'processing error' }) } catch { }
            console.error('[worker] processing error', row.id, e?.message)
          } finally {
            runningSessions.delete(row.id)
          }
        })()
    }
  } catch (e) {
    console.warn('[worker] poll error', e?.message)
  }
}

async function pollTranscribingSessions() {
  try {
    const supabase = supabaseService()

    // First, check all transcribing sessions to see what we have
    const { data: allTranscribing } = await supabase
      .from('sessions')
      .select('id, organization_id, gcs_operation_name, gcs_audio_uri, created_at')
      .eq('status', 'transcribing')
      .limit(50)

    console.log(`[transcribe] Found ${allTranscribing?.length || 0} total transcribing sessions`)

    if (allTranscribing && allTranscribing.length > 0) {
      // console.log(`[recovery] Session details:`, allTranscribing.map(s => ({
      //   id: s.id,
      //   created_at: s.created_at,
      //   has_operation_name: !!s.gcs_operation_name,
      //   operation_name: s.gcs_operation_name
      // })))
      const withOperationName = allTranscribing.filter(s => s.gcs_operation_name)
      const withoutOperationName = allTranscribing.filter(s => !s.gcs_operation_name)


      // For sessions without operation names that are older than 5 minutes, try to reprocess them
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      const oldStuckSessions = withoutOperationName.filter(s => s.created_at < fiveMinutesAgo)

      if (oldStuckSessions.length > 0) {

        const sessionsToReprocess = oldStuckSessions.filter(s => !runningSessions.has(s.id))
        const alreadyRunning = oldStuckSessions.filter(s => runningSessions.has(s.id))

        if (alreadyRunning.length > 0) {
          console.log(`[transcribe] ${alreadyRunning.length} sessions already being processed: ${alreadyRunning.map(s => s.id).join(', ')}`)
        }


        for (const session of sessionsToReprocess) {
          console.log(`[transcribe] Starting reprocessing for session ${session.id}`)
          runningSessions.add(session.id)

            // Try to reprocess the session from audio files
            ; (async () => {
              try {
                await processSession({ sessionId: session.id, organizationId: session.organization_id })
                console.log(`[transcribe] Successfully reprocessed session ${session.id}`)
              } catch (e) {
                console.error(`[transcribe] Failed to reprocess session ${session.id}:`, e?.message)
                try {
                  await updateSession(session.id, {
                    status: 'error',
                    error_message: `Reprocessing failed: ${e?.message || 'unknown error'}`
                  })
                } catch { }
              } finally {
                runningSessions.delete(session.id)
              }
            })()
        }
      }
    }

    // Find sessions that are stuck in transcribing state with GCS operation names
    const { data: stuckSessions } = await supabase
      .from('sessions')
      .select('id, organization_id, gcs_operation_name, gcs_audio_uri')
      .eq('status', 'transcribing')
      .not('gcs_operation_name', 'is', null)
      .limit(20) // Check up to 20 at once

    if (!stuckSessions || stuckSessions.length === 0) return

    console.log(`[transcribe] Found ${stuckSessions.length} sessions with operation names to check`)

    for (const session of stuckSessions) {
      if (transcribingSessions.has(session.id)) continue // Already being handled

      transcribingSessions.add(session.id)
        // Handle status checks asynchronously
        ; (async () => {
          try {
            const completed = await checkTranscriptionStatus({
              sessionId: session.id,
              organizationId: session.organization_id,
              operationName: session.gcs_operation_name,
              gcsUri: session.gcs_audio_uri
            })
            if (completed) {
              console.log(`[transcribe] Transcription completed for session ${session.id}`)
            }
          } catch (e) {
            console.error(`[transcribe] Transcription check failed for session ${session.id}:`, e?.message)
          } finally {
            transcribingSessions.delete(session.id)
          }
        })()
    }
  } catch (e) {
    console.warn('[transcribe] poll error', e?.message)
  }
}

// Start both polling loops
setInterval(pollAndStart, POLL_INTERVAL_MS)
setInterval(pollTranscribingSessions, POLL_INTERVAL_MS * 2) // Check recovery less frequently
