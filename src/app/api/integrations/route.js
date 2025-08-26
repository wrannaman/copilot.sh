import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export async function GET() {
  try {
    const supabase = await createAuthClient()
    const { data: userData, error } = await supabase.auth.getUser()

    if (error || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find user's organization
    const { data: memberships, error: mErr } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .limit(1)

    if (mErr) throw mErr
    const organizationId = memberships?.[0]?.organization_id
    if (!organizationId) {
      return NextResponse.json([], { status: 200 })
    }

    const service = createServiceClient()
    const { data: integrations, error: integrationsError } = await service
      .from('integrations')
      .select('id, type, access_json, created_at, updated_at')
      .eq('organization_id', organizationId)

    if (integrationsError) throw integrationsError

    // Enrich with simple connection status and surface email if present
    const enriched = (integrations || []).map((i) => ({
      ...i,
      status: i?.access_json?.tokens ? 'connected' : 'disconnected',
      email: i?.access_json?.email || null
    }))

    return NextResponse.json(enriched)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch integrations', details: e.message }, { status: 500 })
  }
}


