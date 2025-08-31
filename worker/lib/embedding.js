import { google } from '@ai-sdk/google'
import { embed } from 'ai'

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL_ID || 'text-embedding-004'

function normalizeEmbeddingDimensions(vector, targetDims = 768) {
  const dims = Array.isArray(vector) ? vector.length : 0
  if (dims === targetDims) return vector
  if (dims > targetDims) {
    // Simple, deterministic slice to target size
    const sliced = vector.slice(0, targetDims)
    console.warn('[embedding] normalized by slicing', { from: dims, to: targetDims })
    return sliced
  }
  // Pad with zeros if model returns fewer dims
  const padded = [...vector]
  while (padded.length < targetDims) padded.push(0)
  console.warn('[embedding] normalized by padding', { from: dims, to: targetDims })
  return padded
}

export async function embedTexts(rawTexts = []) {
  const texts = Array.isArray(rawTexts) ? rawTexts : [rawTexts]
  const clean = texts
    .map(t => (t == null ? '' : String(t)))
    .map(s => s.replace(/\u0000/g, '').trim())
    .filter(s => s.length > 0)

  if (clean.length === 0) return []

  const model = google.textEmbedding(DEFAULT_MODEL)

  const out = []
  for (const value of clean) {
    const { embedding } = await embed({
      model,
      value,
      providerOptions: {
        google: {
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: 768,
        },
      },
    })
    const normalized = normalizeEmbeddingDimensions(embedding, 768)
    out.push(normalized)
  }
  return out
}


