"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/auth-guard";
import { useToast } from "@/components/toast-provider";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import {
  Mic,
  Search,
  Calendar,
  History,
  Users,
  Settings,
  Play,
  Pause,
  BarChart3,
  MessageSquare,
  Brain,
  Zap
} from 'lucide-react';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import { SearchComponent } from '@/components/search/search';
// Removed inline GoogleCalendarCard from dashboard; use dedicated Integrations page

function DashboardContent() {
  const { user, currentOrganization } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState({
    totalSessions: 0,
    totalDuration: 0,
    thisWeek: 0,
    searchableChunks: 0
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('search'); // search, recent, analytics

  const lastLoadedOrgId = useRef(null);

  useEffect(() => {
    const orgId = currentOrganization?.org_id;
    if (!orgId) return;

    if (lastLoadedOrgId.current === orgId) return; // prevent duplicate loads in StrictMode
    lastLoadedOrgId.current = orgId;
    loadDashboardData();
  }, [currentOrganization?.org_id, user?.id]);



  const loadDashboardData = async () => {
    const supabase = createClient();
    try {
      // Get recent sessions
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('sessions')
        .select(`
          id,
          title,
          status,
          duration_seconds,
          started_at,
          created_at,
          calendar_event_id
        `)
        .eq('organization_id', currentOrganization.org_id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (sessionsError) throw sessionsError;
      setSessions(sessionsData || []);

      // Get searchable content count from transcripts (since we removed chunks)
      const { count: transcriptsCount, error: transcriptsError } = await supabase
        .from('session_transcripts')
        .select('*', { count: 'exact', head: true })
        .in('session_id', (sessionsData || []).map(s => s.id));

      if (transcriptsError) console.warn('Could not fetch transcripts count:', transcriptsError);

      // Calculate stats
      const totalSessions = sessionsData?.length || 0;
      const totalDuration = sessionsData?.reduce((acc, s) => acc + (s.duration_seconds || 0), 0) || 0;
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thisWeek = sessionsData?.filter(s => new Date(s.created_at) > oneWeekAgo).length || 0;

      setStats({
        totalSessions,
        totalDuration,
        thisWeek,
        searchableChunks: transcriptsCount || 0
      });

    } catch (error) {
      console.error('Dashboard load error:', error);
      toast.error('Failed to load dashboard data', {
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'bg-green-400';
      case 'transcribing': return 'bg-blue-400';
      case 'summarizing': return 'bg-purple-400';
      case 'uploaded': return 'bg-yellow-400';
      case 'error': return 'bg-red-400';
      default: return 'bg-gray-400';
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AuthenticatedNav />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-2">
              {currentOrganization?.logo_url && (
                <img
                  src={currentOrganization.logo_url}
                  alt={`${currentOrganization.org_name || currentOrganization.name} logo`}
                  className="h-12 w-12 object-contain rounded"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground">
                Search your conversations, find commitments, and never forget important details
              </p>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/record">
                    <Mic className="h-4 w-4 mr-2" />
                    Start Recording
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/integrations">
                    <Settings className="h-4 w-4 mr-2" />
                    Setup
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Sessions
                </CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalSessions}</div>
                <p className="text-xs text-muted-foreground">
                  Conversations recorded
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-blue-400 bg-blue-50/50 dark:bg-blue-900/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Total Duration
                </CardTitle>
                <History className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-800 dark:text-blue-200">{formatDuration(stats.totalDuration)}</div>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Hours of content
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-green-400 bg-green-50/50 dark:bg-green-900/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-700 dark:text-green-300">
                  This Week
                </CardTitle>
                <Calendar className="h-4 w-4 text-green-600 dark:text-green-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-800 dark:text-green-200">{stats.thisWeek}</div>
                <p className="text-xs text-green-600 dark:text-green-400">
                  Recent sessions
                </p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-purple-400 bg-purple-50/50 dark:bg-purple-900/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  Searchable
                </CardTitle>
                <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-800 dark:text-purple-200">{stats.searchableChunks}</div>
                <p className="text-xs text-purple-600 dark:text-purple-400">
                  Content chunks
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 mb-6">
            {[
              { id: 'search', label: 'Search', icon: Search },
              { id: 'recent', label: 'Recent Sessions', icon: History },
              { id: 'analytics', label: 'Analytics', icon: BarChart3 }
            ].map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={activeTab === id ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab(id)}
                className="flex items-center gap-2"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>

          {/* Main Content */}
          {activeTab === 'search' && (
            <div className="space-y-6">
              <SearchComponent />
            </div>
          )}

          {activeTab === 'recent' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Recent Sessions */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Recent Sessions</CardTitle>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/record">
                        <Mic className="h-4 w-4 mr-2" />
                        New Recording
                      </Link>
                    </Button>
                  </div>
                  <CardDescription>
                    Your recent conversations and recordings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {sessions.length === 0 ? (
                    <div className="text-center py-6">
                      <Mic className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="font-medium mb-2">No sessions yet</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Start recording to build your searchable memory
                      </p>
                      <Button asChild size="sm">
                        <Link href="/record">
                          <Mic className="h-4 w-4 mr-2" />
                          Start Recording
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sessions.map((session) => (
                        <div key={session.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${getStatusColor(session.status)}`} />
                            <div>
                              <h4 className="font-medium text-sm">{session.title || 'Untitled Session'}</h4>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {session.duration_seconds && (
                                  <span>{formatDuration(session.duration_seconds)}</span>
                                )}
                                {session.calendar_event_id && (
                                  <Badge variant="outline" className="text-xs">
                                    <Calendar className="h-3 w-3 mr-1" />
                                    Meeting
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs capitalize">
                              {session.status}
                            </Badge>
                            <Button variant="ghost" size="sm">
                              View
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                  <CardDescription>
                    Common tasks and integrations
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <Button asChild variant="outline" className="justify-start h-auto p-4">
                      <Link href="/record">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded">
                            <Mic className="h-4 w-4 text-red-600 dark:text-red-400" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium">Start Recording</div>
                            <div className="text-xs text-muted-foreground">Begin a new session</div>
                          </div>
                        </div>
                      </Link>
                    </Button>

                    <Button asChild variant="outline" className="justify-start h-auto p-4">
                      <Link href="/integrations">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded">
                            <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium">Integrations</div>
                            <div className="text-xs text-muted-foreground">Connect Google Calendar</div>
                          </div>
                        </div>
                      </Link>
                    </Button>

                    <Button asChild variant="outline" className="justify-start h-auto p-4">
                      <Link href="/team">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded">
                            <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium">Team Settings</div>
                            <div className="text-xs text-muted-foreground">Manage organization</div>
                          </div>
                        </div>
                      </Link>
                    </Button>

                    <Button asChild variant="outline" className="justify-start h-auto p-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded">
                            <Zap className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div className="text-left">
                            <div className="font-medium">AI Features</div>
                            <div className="text-xs text-muted-foreground">Coming soon</div>
                          </div>
                        </div>
                      </div>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'analytics' && (
            <Card>
              <CardHeader>
                <CardTitle>Analytics</CardTitle>
                <CardDescription>
                  Usage patterns and insights
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center py-8">
                <BarChart3 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-medium mb-2">Analytics Coming Soon</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Track your conversation patterns, most discussed topics, and productivity insights.
                </p>
                <Button variant="outline" disabled>
                  <Zap className="h-4 w-4 mr-2" />
                  Enable Analytics
                </Button>
              </CardContent>
            </Card>
          )}

        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
} 