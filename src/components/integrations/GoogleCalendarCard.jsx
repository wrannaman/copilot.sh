"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/toast-provider';
import {
  CalendarIcon,
  CheckIcon,
  AlertCircleIcon,
  RefreshCwIcon,
  LinkIcon,
  XIcon
} from 'lucide-react';

export default function GoogleCalendarCard({ onRefresh }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [successToastShown, setSuccessToastShown] = useState(false);

  const apiUrl = '/api';

  // Check for success parameter only once on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    console.log('[google-calendar] URL params:', { success, fullUrl: window.location.href });
    
    if (success === 'google_calendar_connected' && !successToastShown) {
      console.log('[google-calendar] Showing success toast');
      
      // Show success toast
      toast.success('Google Calendar connected successfully!', {
        description: 'Your Google Calendar has been connected and is ready to sync.'
      });
      
      // Mark as shown to prevent duplicates
      setSuccessToastShown(true);
      
      // Remove the parameter from URL without page reload
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  // Load integration data
  useEffect(() => {
    checkIntegrationStatus();
    if (integration) {
      getSyncStatus();
    }
  }, [token]);

  // Show follow-up toast with email when integration loads
  useEffect(() => {
    if (successToastShown && integration && integration.access_json?.email) {
      console.log('[google-calendar] Showing follow-up toast with email');
      // Show a more detailed toast with the connected email after a delay
      setTimeout(() => {
        toast.success('Calendar account confirmed!', {
          description: `Successfully connected to ${integration.access_json.email}`
        });
      }, 2000); // 2 second delay to show after the first toast
    }
  }, [integration, successToastShown, toast]);

  const checkIntegrationStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/integrations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      console.log('[google-calendar-card] All integrations response:', {
        status: res.status,
        integrationCount: data?.length || 0,
        integrations: data
      });

      if (res.ok) {
        const gcalIntegration = data.find(item => item.type === 'google_calendar');
        console.log('[google-calendar-card] Google Calendar integration found:', gcalIntegration);
        setIntegration(gcalIntegration || null);
      }
    } catch (error) {
      console.error('[google-calendar-card] Failed to check status:', error);
    }
  };

  const getSyncStatus = async () => {
    if (!integration) return;

    try {
      const res = await fetch(`${apiUrl}/integrations/google-calendar/sync`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.ok) {
        setSyncStatus(data);
      }
    } catch (error) {
      console.error('[google-calendar-card] Failed to get sync status:', error);
    }
  };

  const handleConnect = async () => {
    try {
      setLoading(true);
      toast.info('Redirecting to Google...');
      window.location.href = `${apiUrl}/integrations/google-calendar/oauth/start`;
    } catch (error) {
      setLoading(false);
      toast.error('Setup failed', { description: error.message });
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/google-calendar/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.ok) {
        toast.success('Calendar synced successfully', {
          description: `Synced ${data.syncedEvents} events from ${data.syncedCalendars} calendars`
        });
        getSyncStatus();
        onRefresh?.();
      } else {
        toast.error('Sync failed', { description: data.details || data.error });
      }
    } catch (error) {
      toast.error('Sync failed', { description: error.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch(`${apiUrl}/integrations/google-calendar/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();

      if (res.ok) {
        toast.success('Connection test successful', {
          description: `Connected to ${data.email} with access to ${data.calendarsCount} calendars`
        });
        checkIntegrationStatus();
      } else {
        toast.error('Connection test failed', { description: data.details || data.error });
      }
    } catch (error) {
      toast.error('Connection test failed', { description: error.message });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Google Calendar? This will stop syncing events.')) {
      return;
    }

    try {
      // Note: You'd need to implement a disconnect endpoint
      // For now, we'll just show a message
      toast.info('Disconnect feature coming soon', {
        description: 'Please remove the integration manually for now'
      });
    } catch (error) {
      toast.error('Disconnect failed', { description: error.message });
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  if (!integration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Google Calendar
          </CardTitle>
          <CardDescription>
            Connect your Google Calendar by sharing it with our service account. Click below to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleConnect}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <LinkIcon className="mr-2 h-4 w-4" />
                Connect Google Calendar
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Google Calendar
          </div>
          <Badge variant="secondary" className="bg-emerald-500 text-white dark:bg-emerald-600 gap-1">
            <CheckIcon className="h-3.5 w-3.5" />
            Connected
          </Badge>
        </CardTitle>
        <CardDescription>
          Connected to {integration.access_json?.email || integration.access_json?.service_account_email || 'Google Calendar'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {syncStatus && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Total Events</p>
              <p className="font-medium">{syncStatus.totalEvents}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last Sync</p>
              <p className="font-medium">{formatDate(syncStatus.lastSync)}</p>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing}
            size="sm"
          >
            {testing ? (
              <>
                <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              'Test Connection'
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleSync}
            disabled={syncing}
            size="sm"
          >
            {syncing ? (
              <>
                <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCwIcon className="mr-2 h-4 w-4" />
                Sync Now
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleDisconnect}
            size="sm"
            className="text-destructive hover:text-destructive"
          >
            <XIcon className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        </div>

        {syncStatus && syncStatus.recentEvents > 0 && (
          <div className="text-xs text-muted-foreground border-t pt-3">
            {syncStatus.recentEvents} events synced in the last 7 days
          </div>
        )}
      </CardContent>
    </Card>
  );
}
