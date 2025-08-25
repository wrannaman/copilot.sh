import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST() {
  try {
    const auth = await createClient()
    const { data: userRes, error: authErr } = await auth.auth.getUser()
    if (authErr || !userRes?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const userId = userRes.user.id
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE,
      { auth: { persistSession: false } }
    )

    // Check existing membership (pick first if multiple)
    const { data: membership } = await admin
      .from('org_members')
      .select('organization_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    console.log("🚀 ~ membership:", membership)

    if (membership?.organization_id) {
      const { data: orgRow } = await admin
        .from('org')
        .select('id, name, logo_url, created_at')
        .eq('id', membership.organization_id)
        .maybeSingle()
      return NextResponse.json({ organization: orgRow })
    }

    // Create org + membership idempotently using deterministic org id (userId)
    const { data: orgInsert, error: orgErr } = await admin
      .from('org')
      .upsert({ id: userId, name: 'My Organization', display_name: 'My Organization' }, { onConflict: 'id' })
      .select('id, name, logo_url, created_at')
      .single()

    if (orgErr) {
      console.error("🚀 ~ orgErr:", orgErr)
      return NextResponse.json({ message: 'Failed to create org', details: orgErr.message }, { status: 500 })
    }

    const { error: memErr } = await admin
      .from('org_members')
      .upsert({ user_id: userId, organization_id: orgInsert.id, role: 'owner' }, { onConflict: 'user_id,organization_id' })

    if (memErr) {
      return NextResponse.json({ message: 'Failed to create membership', details: memErr.message }, { status: 500 })
    }

    return NextResponse.json({ organization: orgInsert })
  } catch (e) {
    console.error("🚀 ~ organizations/ensure", e)
    return NextResponse.json({ message: 'Unexpected error', details: e?.message }, { status: 500 })
  }
}


