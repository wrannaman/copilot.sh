import { supabaseService } from './services.js'
import { embedTexts } from './embedding.js'

function toSeconds(time) {
  if (!time) return null
  const s = Number(time.seconds || 0)
  const n = Number(time.nanos || 0)
  return s + (n / 1e9)
}

export function groupWordsIntoChunks(words, maxWordsPerChunk = 75) {
  const chunks = []
  let current = []
  let currentSpeaker = null

  for (const w of words) {
    const speaker = w.speakerTag || currentSpeaker || 'UNKNOWN'
    const chunkFull = current.length >= maxWordsPerChunk
    const speakerChanged = current.length > 0 && speaker !== currentSpeaker
    if (chunkFull || speakerChanged) {
      chunks.push({ words: current, speaker_tag: currentSpeaker })
      current = []
    }
    currentSpeaker = speaker
    current.push(w)
  }

  if (current.length > 0) {
    chunks.push({ words: current, speaker_tag: currentSpeaker })
  }

  return chunks
}

export async function processAndChunkTranscript(sessionId, googleResults) {
  const words = (Array.isArray(googleResults) ? googleResults : (googleResults?.results || []))
    .flatMap(r => r?.alternatives?.[0]?.words || [])

  if (!Array.isArray(words) || words.length === 0) {
    console.log(`[chunks] No words with timestamps for session ${sessionId}`)
    return
  }

  const groups = groupWordsIntoChunks(words)
  const payloads = groups.map(g => {
    const content = g.words.map(w => w.word).join(' ').trim()
    const start = toSeconds(g.words[0]?.startTime)
    const end = toSeconds(g.words[g.words.length - 1]?.endTime)
    return {
      session_id: sessionId,
      content,
      start_time_seconds: start != null ? Math.round(start) : null,
      end_time_seconds: end != null ? Math.round(end) : null,
      speaker_tag: g.speaker_tag ? `SPEAKER_${g.speaker_tag}` : null,
    }
  }).filter(p => p.content && p.content.length > 0)

  // Embeddings
  const texts = payloads.map(p => p.content)
  const embeddings = await embedTexts(texts)
  for (let i = 0; i < payloads.length; i++) {
    payloads[i].embedding = embeddings[i] || null
  }

  const supabase = supabaseService()
  const { error } = await supabase.from('session_chunks').insert(payloads)
  if (error) {
    console.error('[chunks] insert error:', error?.message)
    throw error
  }
  console.log(`[chunks] Inserted ${payloads.length} chunks for session ${sessionId}`)
}


