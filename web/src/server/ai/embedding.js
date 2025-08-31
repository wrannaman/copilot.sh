import { google } from '@ai-sdk/google'
import { embed } from 'ai'

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL_ID || 'text-embedding-004'

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
    out.push(embedding)
  }
  return out
}


