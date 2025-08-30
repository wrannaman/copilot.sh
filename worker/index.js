import dotenv from 'dotenv'
dotenv.config()

import { loadCombinedOrConcat, transcribeWhole } from './lib/audio.js'
import { supabaseService, uploadText, updateSession, uploadAudioToGCS, deleteFromGCS } from './lib/services.js'
import { summarizeTranscript } from './lib/summarize.js'

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

  let transcriptText

  // ALWAYS use GCS for all recordings - simpler, more reliable, handles any duration
  console.log(`[processSession] Always using GCS for transcription (${isChunked ? `${chunkCount} chunks` : 'single file'})`)

  let gcsFile = null
  let transcriptResults = null
  try {
    const { gcsUri, file } = await uploadAudioToGCS(audioBuf, sessionId, organizationId)
    gcsFile = file
    console.log('[processSession] Uploaded to GCS, starting transcription...')

    const { text, results } = await transcribeWhole(audioBuf, gcsUri)
    transcriptText = text
    transcriptResults = results

    // Immediately delete the file from GCS - fuck paying Google for storage!
    console.log('[processSession] Transcription complete, deleting GCS file...')
    await deleteFromGCS(gcsFile)

  } catch (gcsError) {
    console.warn('[processSession] GCS upload failed, falling back to inline:', gcsError.message)
    // Clean up any uploaded file if transcription failed
    if (gcsFile) {
      await deleteFromGCS(gcsFile)
    }
    const { text, results } = await transcribeWhole(audioBuf)
    transcriptText = text
    transcriptResults = results
  }

  console.log("🚀 ~ transcriptText:", transcriptText)

  // Store transcript and raw results
  const transcriptPath = `transcripts/${organizationId}/${sessionId}.txt`
  const entry = `_TIMESTAMP_${new Date().toISOString()}|${transcriptText}\n`
  await uploadText(bucket, transcriptPath, entry)

  // Store raw transcript results with timestamps, confidence, speaker info, etc.
  const rawResultsPath = `transcripts/${organizationId}/${sessionId}.raw.json`
  const rawData = {
    sessionId,
    processedAt: new Date().toISOString(),
    transcriptText,
    totalBilledTime: transcriptResults?.totalBilledTime,
    requestId: transcriptResults?.requestId,
    results: transcriptResults?.results || []
  }
  await uploadText(bucket, rawResultsPath, JSON.stringify(rawData, null, 2), 'application/json')

  await updateSession(sessionId, {
    transcript_storage_path: transcriptPath,
    raw_transcript_path: rawResultsPath
  })

  // Summarize in worker (long-running safe). Respect optional summary_prompt from DB
  try {
    let userPrompt = ''
    try {
      const supa = supabaseService()
      const { data: row } = await supa.from('sessions').select('summary_prompt').eq('id', sessionId).maybeSingle()
      userPrompt = (row?.summary_prompt || '').toString()
    } catch { }
    const plain = entry
      .split('\n')
      .map(line => {
        if (line.startsWith('_TIMESTAMP_')) {
          const idx = line.indexOf('|'); return idx > -1 ? line.slice(idx + 1) : line
        }
        return line
      })
      .join('\n')
      .trim()
    const guided = userPrompt ? `${userPrompt.trim()}\n\n---\n${plain}` : plain
    const object = await summarizeTranscript(guided)
    const sumPath = `summaries/${organizationId}/${sessionId}.json`
    await uploadText(bucket, sumPath, JSON.stringify(object, null, 2), 'application/json')
    console.log('worker summarize done', { sessionId, object })
  } catch (e) {
    console.warn('worker summarize failed', e?.message)
  }
  await updateSession(sessionId, { status: 'ready' })
}

// No HTTP server; worker runs as a poller-only process

// Polling model: periodically claim and process sessions in 'uploaded' status
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000)
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 2)
const runningSessions = new Set()

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
    console.log("🚀 ~ candidates:", candidates)
    for (const row of (candidates || [])) {
      if (runningSessions.has(row.id)) continue
      // Claim atomically
      const { data: claimed, error } = await supabase
        .from('sessions')
        .update({ status: 'transcribing' })
        .eq('id', row.id)
        .eq('status', 'uploaded')
        .select('id')
      if (error) continue
      if (!claimed || claimed.length === 0) continue
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

setInterval(pollAndStart, POLL_INTERVAL_MS)
