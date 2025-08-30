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
    .filter(f => /(\.webm|\.ogg|\.m4a)$/i.test(f.name))
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
  for (const ext of ['ogg', 'webm', 'm4a', 'wav', 'flac']) {
    try {
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
  }

  throw new Error('no audio')
}

async function transcribeWhole(buffer, gcsUri = null) {
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
      enableSpeakerDiarization: true,
      minSpeakerCount: 2,
      maxSpeakerCount: 6,
      enableWordTimeOffsets: true,
      encoding: 'ENCODING_UNSPECIFIED',
    },
    audio: audioConfig
  })
  const [resp] = await op.promise()
  console.log('transcribeWhole ~ resp:', resp)
  const results = resp?.results || []
  console.log('transcribeWhole ~ results:', JSON.stringify(results, null, 2))

  const text = results.map(r => r.alternatives?.[0]?.transcript || '').filter(Boolean).join(' ').trim()

  return {
    text,
    results,
    totalBilledTime: resp?.totalBilledTime,
    requestId: resp?.requestId
  }
}

export { loadCombinedOrConcat, transcribeWhole }


