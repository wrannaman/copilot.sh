import { NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/server'
import { embedTexts } from '@/server/ai/embedding'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  try {
    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const supabase = createServiceClient()
    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id, transcript_storage_path')
      .eq('id', sessionId)
      .maybeSingle()

    if (!session || !session.transcript_storage_path) {
      return NextResponse.json({ message: 'Transcript not available' }, { status: 400 })
    }

    // Optional custom prompt and force flag
    let customPrompt = ''
    let force = false
    try {
      const body = await request.json()
      if (body && typeof body.prompt === 'string') customPrompt = body.prompt
      if (body && body.force === true) force = true
    } catch { }

    // Load transcript
    const { data: blob } = await supabase.storage.from('copilot.sh').download(session.transcript_storage_path)
    if (!blob) return NextResponse.json({ message: 'Transcript file missing' }, { status: 404 })
    const transcriptText = await blob.text()
    const plain = transcriptText
      .split('\n')
      .map(line => {
        if (line.startsWith('_TIMESTAMP_')) {
          const idx = line.indexOf('|')
          return idx > -1 ? line.slice(idx + 1) : line
        }
        return line
      })
      .join('\n')
      .trim()

    const schema = z.object({
      summary: z.string(),
      action_items: z.array(z.string()).default([]),
      topics: z.array(z.string()).default([])
    })

    // If a saved summary exists and not forcing, return it
    const path = `summaries/${session.organization_id}/${session.id}.json`
    if (!force) {
      try {
        const existing = await supabase.storage.from('copilot.sh').download(path)
        if (existing?.data) {
          const txt = await existing.data.text()
          const cached = JSON.parse(txt)
          return NextResponse.json({ ok: true, summary_path: path, ...cached })
        }
      } catch { }
    }

    // Load org-level preferences (default prompt/topics/action_items)
    let orgPrompt = ''
    let orgTopics = []
    let orgActionItems = []
    try {
      const { data: org } = await supabase
        .from('org')
        .select('settings')
        .eq('id', session.organization_id)
        .maybeSingle()
      if (org?.settings?.summary_prefs?.prompt) orgPrompt = String(org.settings.summary_prefs.prompt)
      if (Array.isArray(org?.settings?.summary_prefs?.topics)) orgTopics = org.settings.summary_prefs.topics
      if (Array.isArray(org?.settings?.summary_prefs?.action_items)) orgActionItems = org.settings.summary_prefs.action_items
    } catch { }

    const userGuidanceParts = []
    if (customPrompt && customPrompt.trim()) userGuidanceParts.push(customPrompt.trim())
    if (orgPrompt && orgPrompt.trim()) userGuidanceParts.push(orgPrompt.trim())
    if (orgTopics.length) userGuidanceParts.push(`Emphasize these topics: ${orgTopics.join(', ')}`)
    if (orgActionItems.length) userGuidanceParts.push(`Prioritize action items related to: ${orgActionItems.join(', ')}`)
    const userGuidance = userGuidanceParts.join('\n')

    const { object } = await generateObject({
      model: google(process.env.SUMMARY_MODEL_ID || 'gemini-2.5-flash'),
      schema,
      prompt: `${userGuidance ? userGuidance + '\n\n' : ''}You are an executive meeting summarizer. Produce a concise 5-10 sentence summary and a crisp list of action items. Use neutral tone, avoid fluff, and prefer concrete details. If noisy or repetitive text exists, de-duplicate.

TRANSCRIPT:
${plain.slice(0, 120_000)}
`,
      temperature: 0.2
    })

    // Save summary JSON next to transcript
    await supabase.storage
      .from('copilot.sh')
      .upload(path, new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' })

    // Persist synthesis on sessions and compute session-level embedding
    try {
      const structured = {
        action_items: Array.isArray(object?.action_items) ? object.action_items : [],
        topics: Array.isArray(object?.topics) ? object.topics : []
      }
      const summaryText = (object?.summary || '').toString()
      let summaryEmbedding = null
      if (summaryText && summaryText.trim().length > 0) {
        const [vec] = await embedTexts([summaryText])
        if (Array.isArray(vec) && vec.length) summaryEmbedding = vec
      }

      await supabase
        .from('sessions')
        .update({
          summary_text: summaryText,
          structured_data: structured,
          summary_embedding: summaryEmbedding,
          status: 'ready'
        })
        .eq('id', sessionId)
    } catch (e) {
      console.warn('❌ session synthesis update failed:', e?.message)
      await supabase.from('sessions').update({ status: 'ready' }).eq('id', sessionId)
    }

    return NextResponse.json({ ok: true, summary_path: path, ...object })
  } catch (e) {
    return NextResponse.json({ message: 'Summarization failed', details: e?.message }, { status: 500 })
  }
}


