import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function listUserOrgIds(supa, userId) {
  const { data: orgs, error } = await supa
    .from('org_members')
    .select('organization_id')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (orgs || []).map(o => o.organization_id)
}

async function listSessionRowsForUserOrgs(supa, orgIds) {
  if (!orgIds.length) return []
  const { data, error } = await supa
    .from('sessions')
    .select('id, organization_id, audio_path, transcript_storage_path, raw_transcript_path, whisperx_json_path, whisperx_text_path')
    .in('organization_id', orgIds)
  if (error) throw new Error(error.message)
  return data || []
}

function pathsForSession(row) {
  const paths = []
  if (row?.audio_path) paths.push(row.audio_path)
  if (row?.transcript_storage_path) paths.push(row.transcript_storage_path)
  if (row?.raw_transcript_path) paths.push(row.raw_transcript_path)
  if (row?.whisperx_json_path) paths.push(row.whisperx_json_path)
  if (row?.whisperx_text_path) paths.push(row.whisperx_text_path)
  return Array.from(new Set(paths.filter(Boolean)))
}

async function authAny(request) {
  let supabase = await createAuthClient()
  let { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    const authHeader = request.headers.get('authorization') || ''
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
      } catch { }
    }
  }
  return { supabase, data }
}

export async function POST(request) {
  try {
    const { data: userRes } = await authAny(request)
    const user = userRes?.user
    if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

    const svc = createServiceClient()

    // Collect orgs for this user
    const orgIds = await listUserOrgIds(svc, user.id)

    // List sessions across those orgs created by this user if present; otherwise delete all their org-scoped rows they could own
    const { data: mySessions, error: mySessErr } = await svc
      .from('sessions')
      .select('id, organization_id, created_by, audio_path, transcript_storage_path, raw_transcript_path, whisperx_json_path, whisperx_text_path')
      .in('organization_id', orgIds)
      .eq('created_by', user.id)
    if (mySessErr) throw new Error(mySessErr.message)
    const sessionRows = mySessions || []

    // Delete storage objects referenced by those sessions
    const storage = svc.storage.from('copilot.sh')
    for (const row of sessionRows) {
      const toDelete = pathsForSession(row)
      if (toDelete.length) {
        try { await storage.remove(toDelete) } catch (_) { }
      }
      // Best-effort: also delete transcript folder variants
      try {
        const prefix = `transcripts/${row.organization_id}/${row.id}`
        const { data: list } = await storage.list(prefix.replace(/\/+/g, '/').split('/').slice(0, -1).join('/'))
        const extra = (list || [])
          .map(o => `${prefix.replace(/\/+/g, '/').split('/').slice(0, -1).join('/')}/${o.name}`)
          .filter(p => p.includes(row.id))
        if (extra.length) await storage.remove(extra)
      } catch (_) { }
      try {
        const prefix = `audio/${row.organization_id}/${row.id}`
        const { data: list } = await storage.list(prefix.replace(/\/+/g, '/').split('/').slice(0, -1).join('/'))
        const extra = (list || [])
          .map(o => `${prefix.replace(/\/+/g, '/').split('/').slice(0, -1).join('/')}/${o.name}`)
          .filter(p => p.includes(row.id))
        if (extra.length) await storage.remove(extra)
      } catch (_) { }
    }

    // Delete session rows created by this user (RLS bypass via service role)
    if (sessionRows.length) {
      const ids = sessionRows.map(s => s.id)
      try { await svc.from('session_chunks').delete().in('session_id', ids) } catch (_) { }
      try { await svc.from('sessions').delete().in('id', ids) } catch (_) { }
    }

    // Delete device keys owned by the user
    try { await svc.from('device_api_keys').delete().eq('user_id', user.id) } catch (_) { }

    // Remove memberships for this user (not deleting orgs)
    try { await svc.from('org_members').delete().eq('user_id', user.id) } catch (_) { }

    // Finally, delete the auth user account
    try { await svc.auth.admin.deleteUser(user.id) } catch (_) { }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ message: 'Failed to purge user data', details: e?.message }, { status: 500 })
  }
}


