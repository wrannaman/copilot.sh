import { createClient } from '@supabase/supabase-js'
import { Storage } from '@google-cloud/storage'

let storageClient = null

function getGoogleStorageClient() {
  if (!storageClient) {
    const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
    if (gac.trim().startsWith('{')) {
      try {
        const json = JSON.parse(gac)
        const projectId = json.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT
        if (!json.client_email || !json.private_key) throw new Error('missing SA fields')
        storageClient = new Storage({
          projectId,
          credentials: { client_email: json.client_email, private_key: json.private_key }
        })
      } catch (e) {
        console.error('GAC parse failed for Storage', e?.message)
        storageClient = new Storage()
      }
    } else {
      storageClient = new Storage()
    }
  }
  return storageClient
}

export function supabaseService() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE)
}

export async function downloadFile(bucket, path) {
  const supabase = supabaseService()
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw error
  const ab = await data.arrayBuffer()
  return Buffer.from(ab)
}

export async function listFiles(bucket, prefix) {
  const supabase = supabaseService()
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 10000, sortBy: { column: 'name', order: 'asc' } })
  if (error) throw error
  return (data || []).map(f => ({ name: f.name }))
}

export async function uploadText(bucket, path, text, contentType = 'text/plain; charset=utf-8') {
  const supabase = supabaseService()
  const body = typeof text === 'string' ? Buffer.from(text, 'utf8') : text
  const { error } = await supabase.storage.from(bucket).upload(path, body, { upsert: true, contentType })
  if (error) throw error
}

export async function updateSession(sessionId, fields) {
  const supabase = supabaseService()
  const { error } = await supabase.from('sessions').update(fields).eq('id', sessionId)
  if (error) throw error
}

export async function uploadAudioToGCS(audioBuffer, sessionId, organizationId) {
  const storage = getGoogleStorageClient()
  const bucketName = process.env.GCS_BUCKET_NAME || 'copilot-audio-temp'
  const fileName = `audio/${organizationId}/${sessionId}.wav`

  try {
    const bucket = storage.bucket(bucketName)
    const file = bucket.file(fileName)

    // Upload the audio buffer
    await file.save(audioBuffer, {
      metadata: {
        contentType: 'audio/wav',
      },
    })

    // Return the GCS URI and file reference for cleanup
    const gcsUri = `gs://${bucketName}/${fileName}`
    console.log(`[GCS] Uploaded audio to: ${gcsUri}`)
    return { gcsUri, file }

  } catch (error) {
    console.error('[GCS] Upload failed:', error)
    throw new Error(`Failed to upload audio to GCS: ${error.message}`)
  }
}

export async function deleteFromGCS(file) {
  try {
    await file.delete()
    console.log(`[GCS] Deleted temporary file: ${file.name}`)
  } catch (error) {
    console.warn(`[GCS] Failed to delete file ${file.name}:`, error.message)
  }
}


