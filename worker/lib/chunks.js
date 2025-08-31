import { supabaseService } from './services.js'
import { embedTexts } from './embedding.js'

function toSeconds(time) {
  if (!time) return null
  const s = Number(time.seconds || 0)
  const n = Number(time.nanos || 0)
  return s + (n / 1e9)
}

export function groupWordsIntoChunks(words, options = {}) {
  // Chunk by duration and size only; do not split on speaker changes.
  const maxWordsPerChunk = typeof options === 'number' ? options : (options.maxWordsPerChunk || 400)
  const targetSeconds = typeof options === 'number' ? null : (options.targetSeconds || 180)
  const minCharsPerChunk = typeof options === 'number' ? 120 : (options.minCharsPerChunk || 300)

  const initial = []
  let current = []
  let currentStartSec = null

  for (const w of words) {
    const chunkFullByWords = current.length >= maxWordsPerChunk
    let chunkFullByTime = false
    if (targetSeconds && current.length > 0) {
      const start = currentStartSec != null ? currentStartSec : toSeconds(current[0]?.startTime)
      const end = toSeconds(w?.endTime)
      if (start != null && end != null && end - start >= targetSeconds) {
        chunkFullByTime = true
      }
    }
    if (chunkFullByWords || chunkFullByTime) {
      initial.push({ words: current, speaker_tag: null })
      current = []
      currentStartSec = null
    }
    if (current.length === 0) {
      const s = toSeconds(w?.startTime)
      currentStartSec = s != null ? s : currentStartSec
    }
    current.push(w)
  }

  if (current.length > 0) {
    initial.push({ words: current, speaker_tag: null })
  }

  // Coalesce adjacent tiny chunks by character length
  const coalesced = []
  for (const g of initial) {
    const contentLen = g.words.map(w => w.word).join(' ').trim().length
    if (coalesced.length > 0 && contentLen < minCharsPerChunk) {
      const prev = coalesced[coalesced.length - 1]
      prev.words = prev.words.concat(g.words)
    } else {
      coalesced.push(g)
    }
  }

  return coalesced
}

export async function processAndChunkTranscript(sessionId, googleResults) {
  console.log('[chunks] start', { sessionId })
  const words = (Array.isArray(googleResults) ? googleResults : (googleResults?.results || []))
    .flatMap(r => r?.alternatives?.[0]?.words || [])

  if (!Array.isArray(words) || words.length === 0) {
    console.log(`[chunks] No words with timestamps for session ${sessionId}`)
    return
  }

  const groups = groupWordsIntoChunks(words)
  console.log('[chunks] grouped words', { groups: groups.length })
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
  console.log('[chunks] creating embeddings', { chunks: texts.length })
  const embeddings = await embedTexts(texts)
  console.log('[chunks] embeddings created', { embeddings: embeddings.length })
  for (let i = 0; i < payloads.length; i++) {
    payloads[i].embedding = embeddings[i] || null
  }

  const supabase = supabaseService()
  console.log('[chunks] inserting into supabase.session_chunks', { count: payloads.length })
  const { error } = await supabase.from('session_chunks').insert(payloads)
  if (error) {
    console.error('[chunks] insert error:', error?.message)
    throw error
  }
  console.log(`[chunks] Inserted ${payloads.length} chunks for session ${sessionId}`)
}


