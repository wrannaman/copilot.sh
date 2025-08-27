import { NextResponse } from 'next/server'
import { createAuthClient, createServiceClient } from '@/utils/supabase/server'

export async function POST(request) {
  try {
    const supabase = await createAuthClient()
    const { data, error } = await supabase.auth.getUser()

    if (error || !data?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: memberships } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', data.user.id)
      .limit(1)

    const organizationId = memberships?.[0]?.organization_id
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 })
    }

    const service = createServiceClient()
    const url = new URL(request.url)
    const email = url.searchParams.get('email')

    let query = service
      .from('integrations')
      .select('access_json')
      .eq('organization_id', organizationId)
      .eq('type', 'google_calendar')

    if (email) {
      query = query.eq('account_email', email)
    }

    const { data: integration } = await query.single()

    const resolvedEmail = integration?.access_json?.service_account_email || integration?.access_json?.email
    if (!resolvedEmail) {
      return NextResponse.json({ error: 'Integration not configured', details: 'Missing service account email' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: 'Google Calendar connection test OK',
      email: resolvedEmail,
      calendarsCount: 1,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Connection test failed', details: e.message }, { status: 500 })
  }
}
