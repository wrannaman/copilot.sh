import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { loadSummarizationChain } from 'langchain/chains'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { Document } from '@langchain/core/documents'
import { PromptTemplate } from '@langchain/core/prompts'

export const DEFAULT_USER_PREFERENCES = 'Focus on concrete information, decisions, and actionable items.'

export async function summarizeTranscript(text, instructions = '') {
  // Handle very short transcripts
  if (!text || text.trim().length < 100) {
    return {
      summary: '',
      action_items: [],
      topics: []
    }
  }

  try {
    const model = new ChatGoogleGenerativeAI({
      model: process.env.SUMMARY_MODEL_ID || 'gemini-2.5-pro',
      temperature: 0.2,
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
    })

    // Create text splitter for chunks with overlap
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 8000, // Reasonable chunk size for Gemini
      chunkOverlap: 800, // 10% overlap to maintain context
      separators: ['\n\n', '\n', '. ', ' ', ''] // Better splitting on sentences/paragraphs
    })

    // Create documents from chunks
    const docs = await textSplitter.createDocuments([text])
    console.log(`[summarize] Split transcript into ${docs.length} chunks`)

    // Custom prompts for better control
    const mapPrompt = PromptTemplate.fromTemplate(`
You are an executive meeting summarizer. Analyze this transcript chunk and extract:

1. Key discussion points and decisions
2. Action items and commitments
3. Important topics/themes

USER PREFERENCES: ${instructions || DEFAULT_USER_PREFERENCES}

TRANSCRIPT CHUNK:
{text}

Provide a structured summary focusing on factual content, decisions made, and any action items mentioned.
`)

    const combinePrompt = PromptTemplate.fromTemplate(`
You are summarizing a meeting transcript. Combine these chunk summaries into a final comprehensive summary.

USER PREFERENCES: ${instructions || DEFAULT_USER_PREFERENCES}

CHUNK SUMMARIES:
{text}

Create a final summary with:
1. Overall meeting summary (5-10 sentences)
2. Key action items (as a list)
3. Main topics discussed (as a list)

Use this exact JSON format:
{{
  "summary": "Your summary here...",
  "action_items": ["Item 1", "Item 2"],
  "topics": ["Topic 1", "Topic 2"]
}}
`)

    // Use map-reduce chain for large documents
    const chain = loadSummarizationChain(model, {
      type: 'map_reduce',
      mapPrompt: mapPrompt,
      combinePrompt: combinePrompt,
      returnIntermediateSteps: false
    })

    console.log('[summarize] Running map-reduce summarization...')
    const result = await chain.call({
      input_documents: docs
    })

    // Parse the JSON response
    let parsed
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0])
      } else {
        // Fallback: treat as plain text summary
        parsed = {
          summary: result.text.trim(),
          action_items: [],
          topics: []
        }
      }
    } catch (e) {
      console.warn('[summarize] Failed to parse JSON, using plain text:', e.message)
      parsed = {
        summary: result.text.trim(),
        action_items: [],
        topics: []
      }
    }

    // Clean and validate results
    const badPhrases = /(not enough|insufficient|cannot generate|does not contain enough|no meaningful|too short|brief and consists)/i
    const cleaned = {
      summary: (parsed.summary || '').trim(),
      action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : []
    }

    if (!cleaned.summary || badPhrases.test(cleaned.summary)) {
      cleaned.summary = ''
      cleaned.action_items = []
      cleaned.topics = []
    }

    console.log(`[summarize] Generated summary: ${cleaned.summary.length} chars, ${cleaned.action_items.length} action items, ${cleaned.topics.length} topics`)
    return cleaned
  } catch (error) {
    console.error('[summarize] Error:', error)
    // Fallback to empty summary on error
    return {
      summary: '',
      action_items: [],
      topics: []
    }
  }
}