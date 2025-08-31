import { NextResponse } from 'next/server'
import { google } from '@ai-sdk/google'
import { embed } from 'ai'

export async function POST(req) {
  try {
    const { texts } = await req.json()
    if (!Array.isArray(texts) || texts.length === 0) {
      return NextResponse.json({ error: 'texts array required' }, { status: 400 })
    }

    // Sanitize inputs; filter empty strings which can cause INVALID_ARGUMENT
    const clean = texts.map(t => (t == null ? '' : String(t))).map(s => s.replace(/\u0000/g, '').trim()).filter(s => s.length > 0)
    if (clean.length === 0) {
      return NextResponse.json({ error: 'no non-empty texts provided' }, { status: 400 })
    }

    // Use Google Generative AI provider for embeddings (single value path)
    const model = google.textEmbedding(process.env.EMBEDDING_MODEL_ID || 'text-embedding-004')
    const all = []
    for (const value of clean) {
      try {
        const { embedding } = await embed({
          model,
          value,
          providerOptions: {
            google: {
              taskType: 'RETRIEVAL_QUERY',
              autoTruncate: true,
            },
          },
        })
        all.push(embedding)
      } catch (e) {
        console.error('❌ single embed failed for value:', value.slice(0, 140), e)
        throw e
      }
    }

    return NextResponse.json({ embeddings: all })
  } catch (err) {
    console.error('❌ /api/embed failed:', err)
    return NextResponse.json({ error: err.message || 'Embedding failed', stack: String(err.stack || '') }, { status: 500 })
  }
}


