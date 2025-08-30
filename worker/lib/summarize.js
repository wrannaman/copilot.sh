import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

export async function summarizeTranscript(text) {
  const schema = z.object({
    summary: z.string(),
    action_items: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([])
  })
  const model = google(process.env.SUMMARY_MODEL_ID || 'gemini-2.5-flash')
  const { object } = await generateObject({
    model,
    schema,
    prompt: `You are an executive meeting summarizer.
Rules:
- Produce a concise 5-10 sentence summary only if there is concrete, valuable information.
- If the transcript is too short, noisy, or lacks meaningful details, return an EMPTY summary ("") and EMPTY arrays for action_items and topics.
- Do NOT write meta comments like "not enough information" or explanations about insufficiency.
- Use neutral tone, avoid fluff, prefer concrete details. De-duplicate noise.
\nTRANSCRIPT:\n${text.slice(0, 120000)}`,
    temperature: 0.2
  })
  const badPhrases = /(not enough|insufficient|cannot generate|does not contain enough|no meaningful|too short|brief and consists)/i
  const cleaned = {
    summary: (object.summary || '').trim(),
    action_items: Array.isArray(object.action_items) ? object.action_items : [],
    topics: Array.isArray(object.topics) ? object.topics : []
  }
  if (!cleaned.summary || badPhrases.test(cleaned.summary)) {
    cleaned.summary = ''
    cleaned.action_items = []
    cleaned.topics = []
  }
  return cleaned
}



