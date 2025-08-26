import { NextResponse } from 'next/server';
import { createAuthClient, createServiceClient } from '@/utils/supabase/server';

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || 'Token refresh failed');
  }
  return data; // contains access_token, expires_in, scope, token_type
}

async function googleApiFetch(url, accessToken) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export async function POST(request) {
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

    // Optional filter: specific account email
    const url = new URL(request.url);
    const targetEmail = url.searchParams.get('email');

    const service = createServiceClient();
    let query = service
      .from('integrations')
      .select('id, account_email, access_json')
      .eq('organization_id', organizationId)
      .eq('type', 'google_calendar');

    if (targetEmail) {
      query = query.eq('account_email', targetEmail);
    }

    const { data: integrations, error: integrationsError } = await query;
    if (integrationsError) {
      console.error('[google-calendar-sync] Fetch integrations failed:', integrationsError);
      return NextResponse.json({ error: 'Failed to fetch integrations' }, { status: 500 });
    }

    if (!integrations || integrations.length === 0) {
      console.log('[google-calendar-sync] No integrations found for org', organizationId, 'email filter:', targetEmail);
      return NextResponse.json({ success: true, syncedEvents: 0, syncedCalendars: 0 });
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    let totalCalendars = 0;
    let totalEvents = 0;

    for (const integration of integrations) {
      try {
        const tokens = integration?.access_json?.tokens;
        if (!tokens?.access_token) {
          console.warn('[google-calendar-sync] Missing access token for integration', integration.id);
          continue;
        }

        let accessToken = tokens.access_token;

        // List calendars
        let calendarsResp = await googleApiFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', accessToken);
        if (calendarsResp.status === 401 && tokens.refresh_token) {
          console.log('[google-calendar-sync] Access token expired; refreshing for', integration.account_email);
          try {
            const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken: tokens.refresh_token });
            accessToken = refreshed.access_token;
            // Persist updated token
            const newTokens = { ...tokens, access_token: accessToken, expires_in: refreshed.expires_in, scope: refreshed.scope, token_type: refreshed.token_type };
            const newAccessJson = { ...integration.access_json, tokens: newTokens };
            await service
              .from('integrations')
              .update({ access_json: newAccessJson, updated_at: new Date().toISOString() })
              .eq('id', integration.id);
            calendarsResp = await googleApiFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', accessToken);
          } catch (refreshErr) {
            console.error('[google-calendar-sync] Token refresh failed for', integration.account_email, refreshErr);
          }
        }

        if (!calendarsResp.ok) {
          const body = await calendarsResp.text();
          console.error('[google-calendar-sync] Calendar list fetch failed', calendarsResp.status, body);
          continue;
        }

        const calendarsData = await calendarsResp.json();
        const calendars = calendarsData.items || [];
        console.log('[google-calendar-sync] Calendars for', integration.account_email, 'count:', calendars.length);

        for (const cal of calendars) {
          // Skip if insufficient permissions
          if (cal.accessRole === 'freeBusyReader') {
            console.log('[google-calendar-sync] Skipping calendar', cal.id, 'insufficient permissions');
            continue;
          }

          totalCalendars++;
          const params = new URLSearchParams({
            timeMin,
            timeMax,
            maxResults: '100',
            singleEvents: 'true',
            orderBy: 'startTime',
          });
          const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`;
          const eventsResp = await googleApiFetch(eventsUrl, accessToken);
          if (!eventsResp.ok) {
            const errTxt = await eventsResp.text();
            console.error('[google-calendar-sync] Events fetch failed for cal', cal.id, eventsResp.status, errTxt);
            continue;
          }

          const eventsData = await eventsResp.json();
          const events = eventsData.items || [];
          console.log('[google-calendar-sync] Events fetched for cal', cal.id, 'count:', events.length);

          for (const ev of events) {
            if (!ev.start) continue;
            const startTime = ev.start.dateTime || ev.start.date;
            const endTime = ev.end?.dateTime || ev.end?.date || null;
            if (!startTime) continue;

            const eventRow = {
              organization_id: organizationId,
              external_event_id: ev.id,
              title: ev.summary || 'Untitled Event',
              starts_at: new Date(startTime).toISOString(),
              ends_at: endTime ? new Date(endTime).toISOString() : null,
              attendees: (ev.attendees || []).map(a => ({
                email: a.email,
                displayName: a.displayName || null,
                responseStatus: a.responseStatus || 'needsAction'
              })),
              raw: {
                ...ev,
                calendarId: cal.id,
                calendarName: cal.summary
              }
            };

            const { error: upsertError } = await service
              .from('calendar_events')
              .upsert(eventRow, { onConflict: 'organization_id,external_event_id' });
            if (upsertError) {
              console.error('[google-calendar-sync] Upsert event failed for', ev.id, upsertError);
            } else {
              totalEvents++;
            }
          }
        }
      } catch (intErr) {
        console.error('[google-calendar-sync] Integration sync error for', integration.account_email, intErr);
      }
    }

    return NextResponse.json({ success: true, syncedEvents: totalEvents, syncedCalendars: totalCalendars });

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
export async function GET(request) {
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

    const url = new URL(request.url);
    const targetEmail = url.searchParams.get('email');

    // Get sync status info
    const service = createServiceClient();
    let sel = service
      .from('integrations')
      .select('updated_at, created_at, access_json')
      .eq('organization_id', organizationId)
      .eq('type', 'google_calendar');
    if (targetEmail) sel = sel.eq('account_email', targetEmail);
    const { data: integration } = await sel.single();

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
