import { createClient } from '@/utils/supabase/server'
import { google } from '@ai-sdk/google'
import { embed } from 'ai'
import pdf from 'pdf-parse'
import * as XLSX from 'xlsx'

// Server-side AI model
const aiEmbeddingModel = google.textEmbedding('text-embedding-004', {
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
})

export async function POST(request) {
  console.log('🚀 [PROCESS-FILE] Starting file processing...')

  try {
    const body = await request.json()
    const { filePath, fileId, userId, datasetId } = body

    console.log('📋 [PROCESS-FILE] Request params:', {
      filePath,
      fileId,
      userId,
      datasetId
    })

    if (!filePath || !fileId || !userId || !datasetId) {
      console.error('❌ [PROCESS-FILE] Missing required parameters')
      return Response.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    // Verify user is authenticated
    console.log('🔐 [PROCESS-FILE] Verifying user authentication...')
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    console.log('👤 [PROCESS-FILE] Auth result:', {
      userExists: !!user,
      userIdMatch: user?.id === userId,
      authError: authError?.message
    })

    if (authError || !user || user.id !== userId) {
      console.error('❌ [PROCESS-FILE] Authentication failed')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Download file from storage
    console.log('💾 [PROCESS-FILE] Downloading file from storage:', filePath)
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('secreq')
      .download(filePath)

    if (downloadError) {
      console.error('❌ [PROCESS-FILE] Storage download failed:', {
        error: downloadError,
        filePath,
        bucket: 'secreq'
      })
      throw new Error(`Failed to download file: ${downloadError.message}`)
    }

    console.log('✅ [PROCESS-FILE] File downloaded successfully, size:', fileData.size)

    // Extract text based on file type
    console.log('📄 [PROCESS-FILE] Extracting text from file...')
    const text = await extractTextFromFile(fileData, filePath)
    console.log('✅ [PROCESS-FILE] Text extracted, length:', text.length)

    // Split into chunks
    console.log('✂️ [PROCESS-FILE] Splitting text into chunks...')
    const chunks = splitIntoChunks(text, 1000, 200)
    console.log('✅ [PROCESS-FILE] Created chunks:', chunks.length)

    // Generate embeddings for all chunks
    console.log('🧠 [PROCESS-FILE] Generating embeddings for chunks...')
    console.log('🔧 [EMBEDDING] AI model configuration:', {
      modelName: 'text-embedding-004',
      hasApiKey: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      apiKeyLength: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.length
    })

    const embeddings = await Promise.all(
      chunks.map(async (chunk, index) => {
        console.log(`🔄 [EMBEDDING] Processing chunk ${index + 1}/${chunks.length}`)
        console.log(`📝 [EMBEDDING] Chunk preview (first 100 chars): "${chunk.substring(0, 100)}..."`)

        try {
          const startTime = Date.now()
          const result = await embed({
            model: aiEmbeddingModel,
            value: chunk,
          })
          const endTime = Date.now()

          console.log(`✅ [EMBEDDING] Chunk ${index + 1} embedded successfully in ${endTime - startTime}ms`)
          console.log(`📊 [EMBEDDING] Embedding vector length: ${result.embedding?.length}`)
          console.log(`🎯 [EMBEDDING] First 5 embedding values: [${result.embedding?.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`)

          return result.embedding
        } catch (error) {
          console.error(`❌ [EMBEDDING] Failed to embed chunk ${index + 1}:`, error.message)
          console.error(`🔍 [EMBEDDING] Error details:`, error)
          throw error
        }
      })
    )
    console.log('✅ [PROCESS-FILE] All embeddings generated successfully!')
    console.log(`📈 [EMBEDDING] Total embeddings: ${embeddings.length}, Each vector length: ${embeddings[0]?.length}`)

    // Create chunk objects
    console.log('📦 [PROCESS-FILE] Creating chunk objects...')
    const processedChunks = chunks.map((chunk, index) => ({
      dataset_id: datasetId,
      file_id: fileId,
      content: chunk,
      embedding: embeddings[index],
      chunk_index: index,
      metadata: {
        fileName: filePath.split('/').pop(),
        chunkIndex: index
      }
    }))

    // Store chunks in database
    console.log('💾 [PROCESS-FILE] Storing chunks in database...')
    console.log(`📊 [DATABASE] Inserting ${processedChunks.length} chunks into document_chunks table`)
    console.log(`🔍 [DATABASE] Sample chunk structure:`, {
      keys: Object.keys(processedChunks[0]),
      datasetId: processedChunks[0].dataset_id,
      fileId: processedChunks[0].file_id,
      contentLength: processedChunks[0].content.length,
      embeddingLength: processedChunks[0].embedding.length,
      chunkIndex: processedChunks[0].chunk_index
    })

    const { data, error } = await supabase
      .from('document_chunks')
      .insert(processedChunks)
      .select()

    if (error) {
      console.error('❌ [DATABASE] Failed to store chunks:', error)
      console.error('🔍 [DATABASE] Error details:', {
        code: error.code,
        message: error.message,
        details: error.details
      })
      throw error
    }
    console.log('✅ [DATABASE] Chunks stored successfully!')
    console.log(`📈 [DATABASE] Inserted ${data?.length} chunks, returned IDs: ${data?.slice(0, 3).map(c => c.id.substring(0, 8)).join(', ')}...`)

    // Update file status to completed
    console.log('🏁 [PROCESS-FILE] Updating file status to completed...')
    const { error: updateError } = await supabase
      .from('dataset_files')
      .update({ status: 'completed' })
      .eq('id', fileId)

    if (updateError) {
      console.warn('⚠️ [PROCESS-FILE] Could not update file status:', updateError)
    }

    console.log('🎉 [PROCESS-FILE] File processing completed successfully!')
    return Response.json({
      success: true,
      chunksCreated: processedChunks.length,
      data
    })

  } catch (error) {
    console.error('💥 [PROCESS-FILE] CRITICAL ERROR:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    })

    // Update file status to failed if we have the fileId
    const { fileId } = await request.json().catch(() => ({}))
    if (fileId) {
      try {
        const supabase = await createClient()
        await supabase
          .from('dataset_files')
          .update({ status: 'failed' })
          .eq('id', fileId)
      } catch (statusError) {
        console.warn('Could not update failed file status:', statusError)
      }
    }

    return Response.json(
      { error: 'Failed to process file: ' + error.message },
      { status: 500 }
    )
  }
}

// Server-side text extraction with proper libraries
async function extractTextFromFile(fileData, filePath) {
  const fileName = filePath.split('/').pop()
  const fileExtension = fileName.split('.').pop()?.toLowerCase()

  // Convert blob to buffer for processing
  const buffer = Buffer.from(await fileData.arrayBuffer())

  switch (fileExtension) {
    case 'txt':
    case 'md':
      return buffer.toString('utf-8')

    case 'csv':
      // Parse CSV and convert to readable text
      const csvText = buffer.toString('utf-8')
      const lines = csvText.split('\n')
      const headers = lines[0]?.split(',') || []

      // Convert CSV to readable format
      let readable = `Document contains ${lines.length - 1} records with fields: ${headers.join(', ')}\n\n`

      // Add sample rows for context
      for (let i = 1; i < Math.min(lines.length, 20); i++) {
        if (lines[i]?.trim()) {
          const values = lines[i].split(',')
          readable += `Record ${i}: `
          headers.forEach((header, idx) => {
            if (values[idx]) {
              readable += `${header.trim()}: ${values[idx].trim()}; `
            }
          })
          readable += '\n'
        }
      }

      return readable

    case 'xlsx':
    case 'xls':
      // Parse Excel files
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      let excelText = ''

      workbook.SheetNames.forEach(sheetName => {
        excelText += `\n=== Sheet: ${sheetName} ===\n`
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

        // Add headers
        if (jsonData.length > 0) {
          excelText += `Headers: ${jsonData[0].join(', ')}\n\n`

          // Add sample rows
          for (let i = 1; i < Math.min(jsonData.length, 50); i++) {
            if (jsonData[i] && jsonData[i].some(cell => cell !== undefined && cell !== '')) {
              excelText += `Row ${i}: ${jsonData[i].join(' | ')}\n`
            }
          }
        }
      })

      return excelText

    case 'pdf':
      // Parse PDF files with dynamic import
      try {
        console.log('📄 [PDF] Dynamically importing pdf-parse...')
        const pdfParse = (await import('pdf-parse')).default
        console.log('✅ [PDF] pdf-parse imported successfully')

        console.log('📄 [PDF] Parsing PDF buffer, size:', buffer.length)
        const pdfData = await pdfParse(buffer)
        console.log('✅ [PDF] PDF parsed successfully, text length:', pdfData.text.length)
        console.log('📊 [PDF] PDF info:', { pages: pdfData.numpages, version: pdfData.version })

        return pdfData.text
      } catch (error) {
        console.error('❌ [PDF] PDF parsing failed:', error.message)
        throw new Error(`Failed to parse PDF: ${error.message}`)
      }

    default:
      // Try to read as text
      try {
        return buffer.toString('utf-8')
      } catch (error) {
        throw new Error(`Unsupported file type: ${fileExtension}`)
      }
  }
}

// Helper function to split text into chunks
function splitIntoChunks(text, maxLength = 1000, overlap = 200) {
  const chunks = []
  let start = 0

  while (start < text.length) {
    let end = start + maxLength

    // Try to end at a sentence boundary
    if (end < text.length) {
      const sentenceEnd = text.lastIndexOf('.', end)
      if (sentenceEnd > start + maxLength * 0.7) {
        end = sentenceEnd + 1
      }
    }

    chunks.push(text.slice(start, end).trim())
    start = end - overlap
  }

  return chunks.filter(chunk => chunk.length > 0)
}