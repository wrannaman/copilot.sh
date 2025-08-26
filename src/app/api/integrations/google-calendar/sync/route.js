import { NextResponse } from 'next/server';
import { createAuthClient, createServiceClient } from '@/utils/supabase/server';

export async function POST() {
  try {
    const supabase = await createAuthClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get organization membership
    const { data: memberships } = await supabase
      .from('org_members')
      .select('organization_id, org(name)')
      .eq('user_id', data.user.id)
      .limit(1);

    if (!memberships?.length) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 });
    }

    const organizationId = memberships[0].organization_id;

    // Minimal success placeholder for MVP
    return NextResponse.json({ success: true, syncedEvents: 0, syncedCalendars: 0 });

  } catch (error) {
    console.error('[google-calendar-sync] Error:', error);
    return NextResponse.json(
      {
        error: 'Sync failed',
        details: error.message,
        success: false
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check last sync status
export async function GET() {
  try {
    const supabase = await createAuthClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get organization membership
    const { data: memberships } = await supabase
      .from('org_members')
      .select('organization_id')
      .eq('user_id', data.user.id)
      .limit(1);

    if (!memberships?.length) {
      return NextResponse.json({ error: 'No organization found' }, { status: 400 });
    }

    const organizationId = memberships[0].organization_id;

    // Get sync status info
    const service = createServiceClient();
    const { data: integration } = await service
      .from('integrations')
      .select('updated_at, created_at, access_json')
      .eq('organization_id', organizationId)
      .eq('type', 'google_calendar')
      .single();

    if (!integration) {
      return NextResponse.json({ error: 'Google Calendar integration not found' }, { status: 404 });
    }

    // Get calendar events count
    const { count: eventCount } = await service
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    // Get recent events count (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: recentEventCount } = await service
      .from('calendar_events')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('created_at', sevenDaysAgo);

    return NextResponse.json({
      success: true,
      lastSync: integration.updated_at,
      connectedAt: integration.created_at,
      connectedEmail: integration.access_json?.email || integration.access_json?.service_account_email,
      totalEvents: eventCount || 0,
      recentEvents: recentEventCount || 0
    });

  } catch (error) {
    console.error('[google-calendar-sync-status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: error.message },
      { status: 500 }
    );
  }
}
