import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'
import crypto from 'node:crypto'

function maskKey(key) {
  if (!key || typeof key !== 'string') return ''
  if (key.length <= 7) return key
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export async function GET() {
  try {
    const supabase = await createAuthClient()
    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userRes?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const userId = userRes.user.id
    const { data: orgRow, error: orgErr } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    if (orgErr || !orgRow?.organization_id) {
      return NextResponse.json({ message: 'Organization not found' }, { status: 400 })
    }

    const orgId = orgRow.organization_id
    const svc = createServiceClient()
    const { data: rows, error } = await svc
      .from('device_api_keys')
      .select('id, key, label, user_id, organization_id, active, created_at, last_used_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ message: 'Failed to list keys' }, { status: 500 })
    }

    const sanitized = (rows || []).map(r => ({
      id: r.id,
      label: r.label || '',
      active: !!r.active,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      key_masked: maskKey(r.key)
    }))
    return NextResponse.json({ keys: sanitized })
  } catch (err) {
    return NextResponse.json({ message: 'Unexpected error', details: err?.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const supabase = await createAuthClient()
    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userRes?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const { label } = await request.json().catch(() => ({}))
    const userId = userRes.user.id
    const { data: orgRow } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()

    if (!orgRow?.organization_id) {
      return NextResponse.json({ message: 'Organization not found' }, { status: 400 })
    }

    const orgId = orgRow.organization_id
    const key = crypto.randomBytes(24).toString('base64url')
    const svc = createServiceClient()
    const { data: inserted, error } = await svc
      .from('device_api_keys')
      .insert({ key, label: label || null, user_id: userId, organization_id: orgId, active: true })
      .select('id, created_at')
      .single()

    if (error) {
      return NextResponse.json({ message: 'Failed to create key' }, { status: 500 })
    }

    return NextResponse.json({
      id: inserted.id,
      key,
      label: label || '',
      created_at: inserted.created_at
    })
  } catch (err) {
    return NextResponse.json({ message: 'Unexpected error', details: err?.message }, { status: 500 })
  }
}


