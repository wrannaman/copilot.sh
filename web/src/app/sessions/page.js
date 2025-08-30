"use client";

import { useAuth } from "@/hooks/use-auth";
import { AuthGuard } from "@/components/auth-guard";
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';
import SessionsPanel from '@/components/dashboard/SessionsPanel';

function SessionsContent() {
  const { currentOrganization } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
            <p className="text-muted-foreground mt-2">
              View and manage your recorded sessions and transcripts
            </p>
          </div>

          {/* Sessions Panel */}
          <div className="w-full">
            <SessionsPanel organizationId={currentOrganization?.org_id} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SessionsPage() {
  return (
    <AuthGuard>
      <SessionsContent />
    </AuthGuard>
  );
}
