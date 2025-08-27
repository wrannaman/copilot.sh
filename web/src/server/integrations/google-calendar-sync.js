import { createServiceClient } from '@/utils/supabase/server'

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const data = await resp.json()
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || 'Token refresh failed')
  }
  return data
}

async function googleApiFetch(url, accessToken) {
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
}

export async function syncGoogleCalendarForOrg({ organizationId, targetEmail, timeMin, timeMax }) {
  const service = createServiceClient()

  let query = service
    .from('integrations')
    .select('id, account_email, access_json')
    .eq('organization_id', organizationId)
    .eq('type', 'google_calendar')

  if (targetEmail) {
    query = query.eq('account_email', targetEmail)
  }

  const { data: integrations, error: integrationsError } = await query
  if (integrationsError) {
    throw new Error('Failed to fetch integrations')
  }

  if (!integrations || integrations.length === 0) {
    return { success: true, syncedEvents: 0, syncedCalendars: 0 }
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const effectiveTimeMin = timeMin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const effectiveTimeMax = timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  let totalCalendars = 0
  let totalEvents = 0

  for (const integration of integrations) {
    try {
      const tokens = integration?.access_json?.tokens
      if (!tokens?.access_token) {
        console.warn('[google-calendar-sync] Missing access token for integration', integration.id)
        continue
      }

      let accessToken = tokens.access_token

      // List calendars
      let calendarsResp = await googleApiFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', accessToken)
      if (calendarsResp.status === 401 && tokens.refresh_token) {
        console.log('[google-calendar-sync] Access token expired; refreshing for', integration.account_email)
        try {
          const refreshed = await refreshAccessToken({ clientId, clientSecret, refreshToken: tokens.refresh_token })
          accessToken = refreshed.access_token
          // Persist updated token
          const newTokens = { ...tokens, access_token: accessToken, expires_in: refreshed.expires_in, scope: refreshed.scope, token_type: refreshed.token_type }
          const newAccessJson = { ...integration.access_json, tokens: newTokens }
          await service
            .from('integrations')
            .update({ access_json: newAccessJson, updated_at: new Date().toISOString() })
            .eq('id', integration.id)
          calendarsResp = await googleApiFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', accessToken)
        } catch (refreshErr) {
          console.error('[google-calendar-sync] Token refresh failed for', integration.account_email, refreshErr)
        }
      }

      if (!calendarsResp.ok) {
        const body = await calendarsResp.text()
        console.error('[google-calendar-sync] Calendar list fetch failed', calendarsResp.status, body)
        continue
      }

      const calendarsData = await calendarsResp.json()
      const calendars = calendarsData.items || []
      console.log('[google-calendar-sync] Calendars for', integration.account_email, 'count:', calendars.length)

      for (const cal of calendars) {
        // Skip if insufficient permissions
        if (cal.accessRole === 'freeBusyReader') {
          console.log('[google-calendar-sync] Skipping calendar', cal.id, 'insufficient permissions')
          continue
        }

        totalCalendars++
        const params = new URLSearchParams({
          timeMin: effectiveTimeMin,
          timeMax: effectiveTimeMax,
          maxResults: '100',
          singleEvents: 'true',
          orderBy: 'startTime',
        })
        const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`
        const eventsResp = await googleApiFetch(eventsUrl, accessToken)
        if (!eventsResp.ok) {
          const errTxt = await eventsResp.text()
          console.error('[google-calendar-sync] Events fetch failed for cal', cal.id, eventsResp.status, errTxt)
          continue
        }

        const eventsData = await eventsResp.json()
        const events = eventsData.items || []
        console.log('[google-calendar-sync] Events fetched for cal', cal.id, 'count:', events.length)

        for (const ev of events) {
          if (!ev.start) continue
          const startTime = ev.start.dateTime || ev.start.date
          const endTime = ev.end?.dateTime || ev.end?.date || null
          if (!startTime) continue

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
            raw: { ...ev, calendarId: cal.id, calendarName: cal.summary }
          }

          const { error: upsertError } = await service
            .from('calendar_events')
            .upsert(eventRow, { onConflict: 'organization_id,external_event_id' })
          if (upsertError) {
            console.error('[google-calendar-sync] Upsert event failed for', ev.id, upsertError)
          } else {
            totalEvents++
          }
        }
      }

      // Mark integration as recently synced
      try {
        await service
          .from('integrations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', integration.id)
      } catch (markErr) {
        console.warn('[google-calendar-sync] Failed to mark last sync time for', integration.id, markErr)
      }
    } catch (intErr) {
      console.error('[google-calendar-sync] Integration sync error for', integration.account_email, intErr)
    }
  }

  return { success: true, syncedEvents: totalEvents, syncedCalendars: totalCalendars }
}

export async function shouldSyncForOrg(organizationId, minIntervalMs = 60 * 60 * 1000) {
  const service = createServiceClient()
  const { data, error } = await service
    .from('integrations')
    .select('updated_at')
    .eq('organization_id', organizationId)
    .eq('type', 'google_calendar')
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) return true
  const last = Array.isArray(data) ? data[0] : data
  if (!last?.updated_at) return true
  const lastMs = new Date(last.updated_at).getTime()
  return Date.now() - lastMs >= minIntervalMs
}


