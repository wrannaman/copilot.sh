import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    let supabase = await createAuthClient()
    let { data, error } = await supabase.auth.getUser()
    let deviceMode = false
    let deviceUserId = null
    let deviceOrgId = null

    if (error || !data?.user) {
      const authHeader = request.headers.get('authorization') || ''
      const headerKey = request.headers.get('x-device-key') || ''
      const bearer = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : ''

      if (bearer) {
        try {
          const svc = createServiceClient()
          const { data: jwtUser, error: jwtErr } = await svc.auth.getUser(bearer)
          if (!jwtErr && jwtUser?.user) {
            data = { user: jwtUser.user }
            supabase = svc
          }
        } catch (_) { }
      }

      if (!data?.user) {
        const deviceKey = headerKey || (!bearer ? '' : '')
        if (!deviceKey) {
          return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
        }
        const svc = createServiceClient()
        const { data: deviceRow } = await svc
          .from('device_api_keys')
          .select('user_id, organization_id, active')
          .eq('key', deviceKey)
          .maybeSingle()
        if (!deviceRow || deviceRow.active === false) {
          return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
        }
        deviceMode = true
        deviceUserId = deviceRow.user_id
        deviceOrgId = deviceRow.organization_id
        supabase = svc
        svc.from('device_api_keys').update({ last_used_at: new Date().toISOString() }).eq('key', deviceKey).then(() => { }).catch(() => { })
      }
    }

    const userId = deviceMode ? deviceUserId : data.user.id
    // Resolve org
    let orgId = deviceOrgId || null
    if (!orgId) {
      const { data: orgRow } = await supabase
        .from('org_members')
        .select('organization_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!orgRow?.organization_id) {
        return NextResponse.json({ message: 'User must belong to an organization' }, { status: 400 })
      }
      orgId = orgRow.organization_id
    }

    const startedAt = new Date().toISOString()
    let body = {}
    try { body = await request.json() } catch { }
    const title = typeof body?.title === 'string' ? body.title.slice(0, 200) : null
    const summaryPrompt = typeof body?.summary_prompt === 'string' ? body.summary_prompt.slice(0, 2000) : null
    const { data: session, error: insertErr } = await supabase
      .from('sessions')
      .insert({
        organization_id: orgId,
        created_by: userId,
        status: 'transcribing',
        started_at: startedAt,
        title: title,
        summary_prompt: summaryPrompt
      })
      .select('id, organization_id, created_by, status, started_at')
      .single()

    if (insertErr) {
      return NextResponse.json({ message: 'Failed to create session', details: insertErr.message }, { status: 500 })
    }

    // Pre-create a storage folder path marker (no-op but useful for clients)
    try {
      const svc = createServiceClient()
      const folderMarkerPath = `audio/${session.organization_id}/${session.id}/.keep`
      await svc.storage.from('copilot.sh').upload(folderMarkerPath, new Blob(['ok'], { type: 'text/plain' }), { upsert: true })
    } catch (_) { }

    return NextResponse.json({ session_id: session.id, session })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to create session', details: e?.message }, { status: 500 })
  }
}


