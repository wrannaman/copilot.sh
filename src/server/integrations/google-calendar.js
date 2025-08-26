import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import { createServiceClient } from '@/utils/supabase/server';
import path from 'path';

export class GoogleCalendarService {
  constructor(integration) {
    this.integration = integration;
    this.auth = null;
    this.calendar = null;
    this.initializeClient();
  }

  initializeClient() {
    // Use service account credentials
    this.auth = new GoogleAuth({
      keyFile: path.join(process.cwd(), 'credentials', 'google.json'),
      scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    });

    // Initialize Calendar API
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
  }

  async updateTokens(tokens) {
    try {
      const supabase = createServiceClient();
      
      const updatedAccessJson = {
        ...this.integration.access_json,
        ...tokens
      };

      const { error } = await supabase
        .from('integrations')
        .update({
          access_json: updatedAccessJson,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.integration.id);

      if (error) {
        console.error('[google-calendar] Failed to update tokens:', error);
        throw error;
      }

      // Update local instance
      this.integration.access_json = updatedAccessJson;
    } catch (error) {
      console.error('[google-calendar] Token update error:', error);
      throw error;
    }
  }

  async testConnection() {
    try {
      const response = await this.calendar.calendarList.list({
        maxResults: 1
      });
      
      return {
        success: true,
        calendarsCount: response.data.items?.length || 0,
        email: this.integration.access_json.email
      };
    } catch (error) {
      console.error('[google-calendar] Connection test failed:', error);
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  async getCalendarList() {
    try {
      const response = await this.calendar.calendarList.list();
      return response.data.items || [];
    } catch (error) {
      console.error('[google-calendar] Failed to get calendar list:', error);
      throw error;
    }
  }

  async getEvents(options = {}) {
    try {
      const {
        calendarId = 'primary',
        timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
        timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
        maxResults = 250,
        singleEvents = true,
        orderBy = 'startTime'
      } = options;

      const response = await this.calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents,
        orderBy
      });

      return response.data.items || [];
    } catch (error) {
      console.error('[google-calendar] Failed to get events:', error);
      throw error;
    }
  }

  async syncEventsToDatabase() {
    try {
      const supabase = createServiceClient();
      
      // Get all calendars
      const calendars = await this.getCalendarList();
      let totalSynced = 0;

      for (const calendar of calendars) {
        // Skip if calendar is not selected or accessible
        if (calendar.accessRole === 'freeBusyReader') {
          console.log(`[google-calendar] Skipping calendar ${calendar.id} - insufficient permissions`);
          continue;
        }

        try {
          const events = await this.getEvents({ 
            calendarId: calendar.id,
            maxResults: 100 // Limit per calendar
          });

          for (const event of events) {
            // Skip events without start time
            if (!event.start) continue;

            const startTime = event.start.dateTime || event.start.date;
            const endTime = event.end?.dateTime || event.end?.date;
            
            if (!startTime) continue;

            // Prepare event data for database
            const eventData = {
              organization_id: this.integration.organization_id,
              external_event_id: event.id,
              title: event.summary || 'Untitled Event',
              starts_at: new Date(startTime).toISOString(),
              ends_at: endTime ? new Date(endTime).toISOString() : null,
              attendees: (event.attendees || []).map(attendee => ({
                email: attendee.email,
                displayName: attendee.displayName || null,
                responseStatus: attendee.responseStatus || 'needsAction'
              })),
              raw: {
                ...event,
                calendarId: calendar.id,
                calendarName: calendar.summary
              }
            };

            // Use upsert to handle duplicates
            const { error } = await supabase
              .from('calendar_events')
              .upsert(eventData, {
                onConflict: 'organization_id,external_event_id'
              });

            if (error) {
              console.error(`[google-calendar] Failed to sync event ${event.id}:`, error);
            } else {
              totalSynced++;
            }
          }
        } catch (calendarError) {
          console.error(`[google-calendar] Error syncing calendar ${calendar.id}:`, calendarError);
          continue;
        }
      }

      return { 
        success: true, 
        syncedEvents: totalSynced,
        syncedCalendars: calendars.length 
      };

    } catch (error) {
      console.error('[google-calendar] Sync failed:', error);
      throw error;
    }
  }

  // Helper method to get events for a specific time range
  async getEventsInRange(startDate, endDate, calendarId = 'primary') {
    return this.getEvents({
      calendarId,
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
  }

  // Helper method to get today's events
  async getTodaysEvents(calendarId = 'primary') {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return this.getEventsInRange(startOfDay, endOfDay, calendarId);
  }

  // Helper method to find events by text search
  async searchEvents(query, calendarId = 'primary') {
    try {
      const response = await this.calendar.events.list({
        calendarId,
        q: query,
        singleEvents: true,
        orderBy: 'startTime'
      });

      return response.data.items || [];
    } catch (error) {
      console.error('[google-calendar] Event search failed:', error);
      throw error;
    }
  }
}

// Factory function to create service instance from integration
export async function createGoogleCalendarService(organizationId) {
  const supabase = createServiceClient();
  
  const { data: integration, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('type', 'google_calendar')
    .single();

  if (error || !integration) {
    throw new Error('Google Calendar integration not found');
  }

  return new GoogleCalendarService(integration);
}
