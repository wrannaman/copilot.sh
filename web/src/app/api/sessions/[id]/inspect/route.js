import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const supabase = await createAuthClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const p = await params
    const sessionId = p?.id
    if (!sessionId) return NextResponse.json({ message: 'Missing session id' }, { status: 400 })

    const { data: session } = await supabase
      .from('sessions')
      .select('id, organization_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ message: 'Session not found' }, { status: 404 })

    const svc = createServiceClient()
    const dir = `audio/${session.organization_id}/${session.id}`
    const out = { parts: [], combined: null }
    try {
      const { data: files } = await svc.storage.from('copilot.sh').list(dir, { limit: 10000, sortBy: { column: 'name', order: 'asc' } })
      out.parts = (files || []).map(f => f.name)
    } catch { }
    for (const ext of ['ogg', 'webm', 'm4a', 'wav', 'flac']) {
      try {
        const path = `audio/${session.organization_id}/${session.id}.${ext}`
        const { data: blob } = await svc.storage.from('copilot.sh').download(path)
        if (blob) {
          out.combined = { path, bytes: (await blob.arrayBuffer()).byteLength }
          break
        }
      } catch { }
    }
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ message: 'inspect failed', details: e?.message }, { status: 500 })
  }
}


