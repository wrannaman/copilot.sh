import { SpeechClient } from '@google-cloud/speech'
import { downloadFile, listFiles } from './services.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import ffmpegPath from 'ffmpeg-static'
import { execFile as _execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(_execFile)

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

async function loadCombinedOrConcat(bucket, organizationId, sessionId) {
  const prefixDir = `audio/${organizationId}/${sessionId}`
  console.log('[audio] list dir', { bucket, prefixDir })
  const files = await listFiles(bucket, prefixDir)
  const parts = (files || [])
    .filter(f => /(\.webm|\.ogg|\.m4a|\.wav|\.flac|\.bin)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  console.log('[audio] parts', { count: parts.length, names: parts.map(p => p.name) })

  const dbgDir = path.join(process.cwd(), 'debug')
  await fs.mkdir(dbgDir, { recursive: true }).catch(() => { })

  if (parts.length > 0) {
    // Download parts to a temp dir and concat via ffmpeg → WAV
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `copilot-ffmpeg-${sessionId}-`))
    const listFile = path.join(tmpDir, 'list.txt')
    const partPaths = []
    for (const p of parts) {
      const buf = await downloadFile(bucket, `${prefixDir}/${p.name}`)
      const pth = path.join(tmpDir, p.name)
      await fs.writeFile(pth, buf)
      partPaths.push(pth)
    }
    await fs.writeFile(listFile, partPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
    const outWav = path.join(tmpDir, `${sessionId}.wav`)
    console.log('[audio] ffmpeg concat → wav', { listFile, outWav, count: partPaths.length })
    await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outWav])
    const wavBuf = await fs.readFile(outWav)
    const dbgOut = path.join(dbgDir, `${sessionId}.combined.wav`)
    await fs.writeFile(dbgOut, wavBuf).catch(() => { })
    console.log('[audio] wrote debug combined wav', { dbgOut, bytes: wavBuf.length })
    return { buffer: wavBuf, isChunked: true, chunkCount: parts.length }
  }

  // Fallback: single combined in storage → transcode to WAV
  // Try both locations: audio/org/session.ext (new) and audio/org/session/session.ext (legacy)
  for (const ext of ['ogg', 'webm', 'm4a', 'wav', 'flac', 'bin', 'mp3']) {
    try {
      // First try the combined file location (where single uploads go)
      const storagePath = `audio/${organizationId}/${sessionId}.${ext}`
      const buf = await downloadFile(bucket, storagePath)
      if (buf && buf.length > 0) {
        console.log('[audio] found storage combined', { storagePath, bytes: buf.length })
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `copilot-single-${sessionId}-`))
        const inFile = path.join(tmpDir, `in.${ext}`)
        const outWav = path.join(tmpDir, `${sessionId}.wav`)
        await fs.writeFile(inFile, buf)
        await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', inFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outWav])
        const wavBuf = await fs.readFile(outWav)
        const dbgOut = path.join(dbgDir, `${sessionId}.combined.wav`)
        await fs.writeFile(dbgOut, wavBuf).catch(() => { })
        console.log('[audio] wrote debug combined wav (single)', { dbgOut, bytes: wavBuf.length })
        return { buffer: wavBuf, isChunked: false, chunkCount: 1 }
      }
    } catch { }

    try {
      // Also try legacy chunked-session location in case it's stored there
      const legacyPath = `${prefixDir}/${sessionId}.${ext}`
      const buf = await downloadFile(bucket, legacyPath)
      if (buf && buf.length > 0) {
        console.log('[audio] found legacy combined', { legacyPath, bytes: buf.length })
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `copilot-legacy-${sessionId}-`))
        const inFile = path.join(tmpDir, `in.${ext}`)
        const outWav = path.join(tmpDir, `${sessionId}.wav`)
        await fs.writeFile(inFile, buf)
        await execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', inFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outWav])
        const wavBuf = await fs.readFile(outWav)
        const dbgOut = path.join(dbgDir, `${sessionId}.combined.wav`)
        await fs.writeFile(dbgOut, wavBuf).catch(() => { })
        console.log('[audio] wrote debug combined wav (legacy)', { dbgOut, bytes: wavBuf.length })
        return { buffer: wavBuf, isChunked: false, chunkCount: 1 }
      }
    } catch { }
  }

  throw new Error('no audio')
}

async function transcribeWhole(buffer, gcsUri = null, onOperationStart = null, waitForResults = true) {
  const speech = getSpeechClient()

  // Determine if we should use GCS URI or inline audio
  const audioConfig = gcsUri
    ? { uri: gcsUri }
    : { content: buffer.toString('base64') }

  console.log(`[transcribe] Using ${gcsUri ? 'GCS URI' : 'inline audio'} for transcription`)

  const [op] = await speech.longRunningRecognize({
    config: {
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      diarizationConfig: {
        enableSpeakerDiarization: true,
        minSpeakerCount: 2,
        maxSpeakerCount: 6
      },
      enableWordTimeOffsets: true,
      encoding: 'ENCODING_UNSPECIFIED',
    },
    audio: audioConfig
  })

  const operationName = op.name
  console.log('[transcribe] Long-running operation started', { operationName })

  // Immediately call the callback with the operation name so it can be saved
  if (onOperationStart) {
    try {
      await onOperationStart(operationName)
    } catch (callbackError) {
      console.error('[transcribe] Callback error:', callbackError?.message)
      // Continue transcription even if callback fails
    }
  }

  // If using GCS, prefer returning immediately and letting recovery poll pick it up
  if (gcsUri && waitForResults === false) {
    return { text: '', results: [], operationName }
  }


  const startTime = Date.now()

  // Add periodic progress logging
  const progressInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    console.log(`[transcribe] Still processing... ${elapsed} minutes elapsed`)
  }, 60000) // Log every minute

  let resp
  try {
    [resp] = await op.promise()
    clearInterval(progressInterval)
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    console.log(`[transcribe] Completed after ${totalTime} minutes`)
  } catch (error) {
    clearInterval(progressInterval)
    throw error
  }

  // Avoid logging full response to prevent oversized payloads in logs

  // Handle different response structures from Google Speech API
  let results = []
  if (resp?.results) {
    results = resp.results
  } else if (resp?.value?.results) {
    results = resp.value.results
  } else if (Array.isArray(resp)) {
    results = resp
  } else {
    console.log('transcribeWhole ~ Unexpected response structure:', JSON.stringify(resp, null, 2))
    results = []
  }

  console.log('transcribeWhole ~ results array length:', results.length)

  const text = results.map(r => r.alternatives?.[0]?.transcript || '').filter(Boolean).join(' ').trim()
  console.log('transcribeWhole ~ extracted text length:', text.length)
  console.log('transcribeWhole ~ text preview:', text.substring(0, 200) + '...')

  return {
    text,
    results,
    totalBilledTime: resp?.totalBilledTime,
    requestId: resp?.requestId,
    operationName
  }
}

export { loadCombinedOrConcat, transcribeWhole }

// WhisperX integration: run Python script with diarization and return JSON
export async function transcribeWithWhisperX(buffer) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `copilot-whisperx-`))
  const audioFile = path.join(tmpDir, `audio.wav`)
  await fs.writeFile(audioFile, buffer)

  // Resolve script in several likely locations:
  // - ../whisper relative to process cwd
  // - ./whisper relative to process cwd
  // - ../../whisper relative to this module file
  const moduleDir = path.dirname(new URL(import.meta.url).pathname)
  const candidates = [
    path.resolve(process.cwd(), '..', 'whisper', 'whisperx_transcribe.py'),
    path.resolve(process.cwd(), 'whisper', 'whisperx_transcribe.py'),
    path.resolve(moduleDir, '..', '..', 'whisper', 'whisperx_transcribe.py')
  ]
  let scriptPath = null
  for (const c of candidates) {
    try { await fs.access(c); scriptPath = c; break } catch {}
  }
  if (!scriptPath) {
    throw new Error(`whisperx script not found in candidates: ${candidates.join(', ')}`)
  }
  const pythonBin = process.env.WHISPERX_PYTHON || 'python3'

  console.log('[whisperx] launching', { pythonBin, scriptPath, candidates, audioFileBytes: buffer.length })

  try {
    const { stdout, stderr } = await execFile(pythonBin, [scriptPath, audioFile], { maxBuffer: 1024 * 1024 * 200 })
    if (stderr && stderr.trim().length > 0) {
      console.log('[whisperx][stderr]', stderr.slice(0, 2000))
    }
    let parsed
    try {
      parsed = JSON.parse(stdout)
    } catch (e) {
      throw new Error(`failed to parse whisperx json: ${e?.message}`)
    }

    const segments = Array.isArray(parsed?.segments) ? parsed.segments : []
    const text = segments.map(s => s?.text || '').filter(Boolean).join(' ').trim()

    return { text, json: parsed }
  } catch (error) {
    console.warn('[whisperx] failed:', error?.message)
    throw error
  }
}


