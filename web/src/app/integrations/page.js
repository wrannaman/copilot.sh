"use client";

import { useState, useEffect } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from "@/components/layout/authenticated-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import GoogleCalendarCard from "@/components/integrations/GoogleCalendarCard";
import DeviceKeysCard from "@/components/integrations/DeviceKeysCard";
import { LinkIcon } from "lucide-react";

function IntegrationsContent() {

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold mb-2">Integrations</h1>
              <p className="text-muted-foreground">
                Connect external services to enhance your workflow and data collection.
              </p>
            </div>
            <Button
              onClick={() => { window.location.href = "/api/integrations/google-calendar/oauth/start"; }}
              className="gap-2"
            >
              <LinkIcon className="h-4 w-4" />
              Connect Google Calendar
            </Button>
          </div>

          {/* Available Integrations */}
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Available Integrations</h2>
            <GoogleCalendarCard />
            <DeviceKeysCard />
          </div>


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

