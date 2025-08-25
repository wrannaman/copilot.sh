import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { createClient as createServiceClient } from '@/utils/supabase/server'
import { embedTexts } from '@/server/ai/embedding'


/// const model = google.textEmbedding('gemini-embedding-001');
export async function POST(req) {
  try {
    const { prompt, sessionIds = [], topK = 12 } = await req.json()
    console.log('🧠 AI PROMPT OUTBOUND →', prompt)
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }

    // Retrieve vector context from Supabase RPCs
    const supabase = await createServiceClient()
    let chunks = []
    if (Array.isArray(sessionIds) && sessionIds.length > 0) {
      const [queryEmbedding] = await embedTexts([prompt])
      if (!queryEmbedding || !Array.isArray(queryEmbedding)) throw new Error('embed failed: empty result')
      const { data, error } = await supabase.rpc('match_session_chunks', {
        query_embedding: queryEmbedding,
        session_ids: sessionIds,
        match_threshold: 0.7,
        match_count: topK
      })
      if (!error && Array.isArray(data)) chunks = data
    }

    const contextText = [
      chunks.length ? `SESSION CONTEXT:\n${chunks.map((c, i) => `[Chunk ${i + 1}] (S${c.speaker_tag ?? '-'} @ ${c.start_time_seconds ?? '-'}s)\n${c.content}\n`).join('\n')}` : ''
    ].filter(Boolean).join('\n\n')

    const schema = z.object({
      answer: z.string(),
      confidence: z.number().min(0).max(1),
      citations: z.array(z.object({ source: z.string(), snippet: z.string().optional() })).default([])
    })

    const { object } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema,
      prompt: `You are a security questionnaire assistant. Keep answers concise (1-3 sentences).\n\nContext:\n${contextText || 'None'}\n\nQuestion:\n${prompt}`,
      temperature: 0.2
    })

    return NextResponse.json(object)
  } catch (err) {
    console.error('❌ /api/generate failed:', err)
    return NextResponse.json({ error: err.message || 'Generation failed', stack: String(err.stack || '') }, { status: 500 })
  }
}


