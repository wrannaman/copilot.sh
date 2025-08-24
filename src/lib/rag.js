// All AI operations moved to server-side API routes

export async function generateAnswer(question, selectedDatasets = [], questionnaireId = null, supabaseClient = null, userId = null) {
  if (!supabaseClient) {
    throw new Error('Supabase client is required. Pass a client instance to this function.');
  }
  if (!userId) {
    throw new Error('User ID is required for secure embedding generation.');
  }
  try {
    // Step 1: Generate embedding for the question via API
    const response = await fetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: [question],
        userId: userId
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding API failed: ${response.statusText}`);
    }

    const { embeddings } = await response.json();
    const questionEmbedding = embeddings[0];

    // Step 2: Retrieve relevant context from datasets and QA library
    const context = await retrieveContext(questionEmbedding, selectedDatasets, questionnaireId, supabaseClient);

    // Step 3: Generate answer using retrieved context
    const answer = await generateAnswerWithContext(question, context, userId);

    return answer;
  } catch (error) {
    console.error('RAG pipeline error:', error);
    throw new Error('Failed to generate answer: ' + error.message);
  }
}

async function retrieveContext(questionEmbedding, selectedDatasets = [], questionnaireId = null, supabaseClient, topK = 10) {
  const context = {
    documents: [],
    qaLibrary: [],
    totalSources: 0
  };

  try {
    // Retrieve from document chunks if datasets are selected
    if (selectedDatasets.length > 0) {
      const datasetIds = selectedDatasets.map(d => d.id);

      const { data: documentChunks, error: docError } = await supabaseClient.rpc(
        'match_document_chunks',
        {
          query_embedding: questionEmbedding,
          dataset_ids: datasetIds,
          match_threshold: 0.7,
          match_count: Math.ceil(topK / 2)
        }
      );

      if (docError) {
        console.error('Document chunk retrieval error:', docError);
      } else {
        context.documents = documentChunks || [];
      }
    }

    // Retrieve from QA library
    const { data: qaMatches, error: qaError } = await supabaseClient.rpc(
      'match_qa_library',
      {
        query_embedding: questionEmbedding,
        match_threshold: 0.75,
        match_count: Math.ceil(topK / 2)
      }
    );

    if (qaError) {
      console.error('QA library retrieval error:', qaError);
    } else {
      context.qaLibrary = qaMatches || [];
    }

    context.totalSources = context.documents.length + context.qaLibrary.length;

    return context;
  } catch (error) {
    console.error('Context retrieval error:', error);
    return context;
  }
}

async function generateAnswerWithContext(question, context, userId) {
  try {
    // Build context prompt
    let contextPrompt = '';

    if (context.documents.length > 0) {
      contextPrompt += '\n\nRELEVANT DOCUMENTATION:\n';
      context.documents.forEach((chunk, index) => {
        contextPrompt += `\n[Document ${index + 1}] ${chunk.file_name || 'Unknown File'}`;
        if (chunk.metadata?.page) contextPrompt += ` (Page ${chunk.metadata.page})`;
        contextPrompt += `:\n${chunk.content}\n`;
      });
    }

    if (context.qaLibrary.length > 0) {
      contextPrompt += '\n\nRELATED Q&A EXAMPLES:\n';
      context.qaLibrary.forEach((qa, index) => {
        contextPrompt += `\n[Q&A ${index + 1}]\n`;
        contextPrompt += `Question: ${qa.question}\n`;
        contextPrompt += `Answer: ${qa.answer}\n`;
      });
    }

    const systemPrompt = `You are an expert security compliance assistant helping organizations answer security questionnaires.

Your role is to:
1. Provide accurate, CONCISE answers based on the provided documentation
2. Keep responses to 1-3 sentences unless more detail is specifically requested
3. Reference specific sources when possible
4. Ensure answers are compliant with security frameworks (SOC2, ISO27001, etc.)
5. Be direct and actionable, avoiding lengthy explanations

Guidelines:
- Always base answers on the provided documentation when available
- If no relevant documentation is found, provide brief best practices
- Include specific citations to source materials
- Use professional, confident language appropriate for security audits
- IMPORTANT: Keep answers short and focused

Context: ${contextPrompt || 'No specific documentation provided.'}`;

    const userPrompt = `Question: ${question}

Please provide a CONCISE answer (1-3 sentences) based on the documentation provided. Include specific references to sources when possible.`;

    // Use server-side text generation API
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        userId: userId
      })
    });

    if (!response.ok) {
      throw new Error(`Text generation API failed: ${response.statusText}`);
    }

    const { text } = await response.json();

    // Calculate confidence score based on context quality and quantity
    const confidence = calculateConfidence(context, question, text);

    // Extract citations from context
    const citations = extractCitations(context);

    return {
      answer: text,
      confidence,
      citations,
      sourceCount: context.totalSources
    };
  } catch (error) {
    console.error('Answer generation error:', error);
    throw new Error('Failed to generate answer with AI model');
  }
}

function calculateConfidence(context, question, answer) {
  let confidence = 0.5; // Base confidence

  // Boost confidence based on available sources
  if (context.totalSources >= 3) confidence += 0.2;
  else if (context.totalSources >= 1) confidence += 0.1;

  // Boost confidence if we have QA library matches (more targeted)
  if (context.qaLibrary.length > 0) confidence += 0.15;

  // Boost confidence if we have document matches
  if (context.documents.length > 0) confidence += 0.1;

  // Reduce confidence for very short answers (might indicate insufficient info)
  if (answer.length < 100) confidence -= 0.1;

  // Reduce confidence if answer contains uncertainty phrases
  const uncertaintyPhrases = [
    'not sure', 'unclear', 'insufficient information',
    'may vary', 'depends on', 'would need more information'
  ];

  const hasUncertainty = uncertaintyPhrases.some(phrase =>
    answer.toLowerCase().includes(phrase)
  );

  if (hasUncertainty) confidence -= 0.15;

  // Ensure confidence is between 0 and 1
  return Math.max(0, Math.min(1, confidence));
}

function extractCitations(context) {
  const citations = [];

  // Add document citations
  context.documents.forEach((chunk, index) => {
    citations.push({
      source: chunk.file_name || `Document ${index + 1}`,
      content: chunk.content.substring(0, 200) + '...',
      page: chunk.metadata?.page,
      section: chunk.metadata?.section,
      relevance_score: chunk.similarity || 0,
      type: 'document'
    });
  });

  // Add QA library citations
  context.qaLibrary.forEach((qa, index) => {
    citations.push({
      source: `Q&A Library - ${qa.section || 'General'}`,
      content: `Q: ${qa.question}\nA: ${qa.answer}`,
      relevance_score: qa.similarity || 0,
      type: 'qa_library'
    });
  });

  return citations;
}

// Function to process and store document chunks with embeddings
export async function processDocument(file, datasetId, metadata = {}, supabaseClient = null) {
  if (!supabaseClient) {
    throw new Error('Supabase client is required. Pass a client instance to this function.');
  }
  try {
    // Extract text from file (implementation depends on file type)
    const text = await extractTextFromFile(file);

    // Split into chunks
    const chunks = splitIntoChunks(text, 1000, 200); // 1000 chars with 200 char overlap

    // Generate embeddings via API (server-side)
    const response = await fetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: chunks,
        userId: metadata.userId
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding API failed: ${response.statusText}`);
    }

    const { embeddings } = await response.json();

    // Create chunk objects with embeddings
    const processedChunks = chunks.map((chunk, index) => ({
      dataset_id: datasetId,
      file_id: metadata.fileId,
      content: chunk,
      embedding: embeddings[index],
      chunk_index: index,
      metadata: {
        ...metadata,
        fileName: file.name,
        fileSize: file.size,
        chunkIndex: index
      }
    }));

    // Store in database
    const { data, error } = await supabaseClient
      .from('document_chunks')
      .insert(processedChunks)
      .select();

    if (error) throw error;

    return {
      success: true,
      chunksCreated: processedChunks.length,
      data
    };
  } catch (error) {
    console.error('Document processing error:', error);
    throw new Error('Failed to process document: ' + error.message);
  }
}

// Helper function to extract text from different file types
async function extractTextFromFile(file) {
  const fileType = file.type;

  if (fileType === 'text/plain' || fileType === 'text/csv') {
    return await file.text();
  }

  if (fileType === 'application/pdf') {
    // For PDF processing, you'd typically use a library like pdf-parse
    // This is a placeholder - implement based on your needs
    throw new Error('PDF processing not implemented yet');
  }

  if (fileType.includes('spreadsheet') || fileType.includes('excel')) {
    // For Excel processing, you'd typically use xlsx library
    // This is a placeholder - implement based on your needs
    throw new Error('Excel processing not implemented yet');
  }

  // Fallback to treating as text
  return await file.text();
}

// Helper function to split text into chunks
function splitIntoChunks(text, maxLength = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLength;

    // Try to end at a sentence boundary
    if (end < text.length) {
      const sentenceEnd = text.lastIndexOf('.', end);
      if (sentenceEnd > start + maxLength * 0.7) {
        end = sentenceEnd + 1;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter(chunk => chunk.length > 0);
}

// Function to add approved answers to QA library
export async function addToQALibrary(organizationId, question, answer, metadata = {}, supabaseClient = null, userId = null) {
  if (!supabaseClient) {
    throw new Error('Supabase client is required. Pass a client instance to this function.');
  }
  if (!userId) {
    throw new Error('User ID is required for secure embedding generation.');
  }
  try {
    // Generate embedding via API (server-side)
    const response = await fetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: [question],
        userId: userId
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding API failed: ${response.statusText}`);
    }

    const { embeddings } = await response.json();
    const embedding = embeddings[0];

    const { data, error } = await supabaseClient
      .from('qa_library')
      .insert({
        organization_id: organizationId,
        question,
        answer,
        embedding,
        metadata,
        section: metadata.section || null
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('QA library addition error:', error);
    throw new Error('Failed to add to QA library: ' + error.message);
  }
}
