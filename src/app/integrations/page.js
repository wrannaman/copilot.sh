"use client";

import { useState, useEffect } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import GoogleCalendarCard from "@/components/integrations/GoogleCalendarCard";
import { Settings, Calendar, Database } from "lucide-react";

function IntegrationsContent() {
  const { token } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchIntegrations();
    }
  }, [token]);

  const fetchIntegrations = async () => {
    try {
      const res = await fetch('/api/integrations', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      
      console.log('[integrations-page] Fetched integrations:', data);
      
      if (res.ok) {
        setIntegrations(data);
      }
    } catch (error) {
      console.error('[integrations-page] Failed to fetch integrations:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const getIntegrationIcon = (type) => {
    switch (type) {
      case 'google_calendar': return Calendar;
      case 'snowflake': return Database;
      default: return Settings;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-semibold mb-2">Integrations</h1>
            <p className="text-muted-foreground">
              Connect external services to enhance your workflow and data collection.
            </p>
          </div>

          {/* Integration Summary */}
          {!loading && integrations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Connected Integrations ({integrations.length})
                </CardTitle>
                <CardDescription>
                  Overview of your active integrations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {integrations.map((integration) => {
                    const Icon = getIntegrationIcon(integration.type);
                    return (
                      <div key={integration.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <h4 className="font-medium capitalize">
                              {integration.type.replace('_', ' ')}
                            </h4>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              {integration.access_json?.email && (
                                <span>{integration.access_json.email}</span>
                              )}
                              <span>•</span>
                              <span>Connected {formatDate(integration.access_json?.connected_at || integration.created_at)}</span>
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          Active
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Available Integrations */}
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Available Integrations</h2>
            <GoogleCalendarCard onRefresh={fetchIntegrations} />
          </div>

          {/* Debug Info */}
          {process.env.NODE_ENV === 'development' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Debug Info</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                  {JSON.stringify({ integrations, loading }, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <AuthGuard>
      <IntegrationsContent />
    </AuthGuard>
  );
}

