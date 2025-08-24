import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { createClient as createServiceClient } from '@/utils/supabase/server'
import { embedTexts } from '@/server/ai/embedding'


/// const model = google.textEmbedding('gemini-embedding-001');
export async function POST(req) {
  try {
    const { prompt, organizationId, datasetIds = [], topK = 12 } = await req.json()
    console.log("🚀 ~ datasetIds:", datasetIds)
    console.log('🧠 AI PROMPT OUTBOUND →', prompt)
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }

    // Retrieve vector context from Supabase RPCs
    const supabase = await createServiceClient()
    let documents = []
    let queryEmbedding = []
    if (Array.isArray(datasetIds) && datasetIds.length > 0) {
      queryEmbedding = await embedTexts([prompt])
      if (!queryEmbedding.length) throw new Error('embed failed: empty result')
      const { data, error } = await supabase.rpc('match_document_chunks', {
        query_embedding: queryEmbedding[0],
        dataset_ids: datasetIds,
        match_threshold: 0.7,
        match_count: Math.ceil(topK / 2)
      })
      if (!error && Array.isArray(data)) documents = data
    }

    // QA library context (org-level)
    let qaLibrary = []
    if (organizationId) {
      const embedArr2 = queryEmbedding.length ? queryEmbedding : await embedTexts([prompt])
      const { data, error } = await supabase.rpc('match_qa_library', {
        query_embedding: embedArr2[0],
        match_threshold: 0.75,
        match_count: Math.ceil(topK / 2)
      })
      if (!error && Array.isArray(data)) qaLibrary = data
    }

    const contextText = [
      documents.length ? `DOCUMENT CONTEXT:\n${documents.map((d, i) => `[Doc ${i + 1}] ${d.file_name || ''}\n${d.content}\n`).join('\n')}` : '',
      qaLibrary.length ? `QA LIBRARY:\n${qaLibrary.map((q, i) => `[QA ${i + 1}] Q: ${q.question}\nA: ${q.answer}\n`).join('\n')}` : ''
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


