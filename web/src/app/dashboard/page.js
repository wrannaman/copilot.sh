"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/auth-guard";

import Link from "next/link";
import {
  Mic,
  Search,
  Settings,
  BarChart3,
  Zap
} from 'lucide-react';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import { SearchComponent } from '@/components/search/search';
// Removed inline GoogleCalendarCard from dashboard; use dedicated Integrations page
import QuickActions from '@/components/dashboard/QuickActions'
import SessionsPanel from '@/components/dashboard/SessionsPanel'
import TextIngestCard from '@/components/dashboard/TextIngestCard'

function DashboardContent() {
  const { user, currentOrganization } = useAuth();
  const [activeTab, setActiveTab] = useState('search'); // search, analytics


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

          {/* Metrics removed for simplicity */}

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 mb-6">
            {[
              { id: 'search', label: 'Search', icon: Search },
              { id: 'sessions', label: 'Sessions', icon: Mic },
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

              {/* Quick Actions */}
              <div className="w-full max-w-4xl mx-auto">
                <QuickActions />
              </div>

              {/* Text Ingest */}
              <div className="w-full max-w-4xl mx-auto">
                <TextIngestCard />
              </div>
            </div>
          )}

          {activeTab === 'sessions' && (
            <div className="space-y-6">
              <div className="w-full max-w-6xl mx-auto">
                <SessionsPanel organizationId={currentOrganization?.org_id} />
              </div>
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