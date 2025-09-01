"use client";

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/utils/supabase/client';
const apiUrl = process.env.NEXT_PUBLIC_APP_URL;

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { toast } = useToast();

  useEffect(() => {
    const run = async () => {
      let effectiveToken = token;
      if (!effectiveToken) {
        try {
          effectiveToken = localStorage.getItem('pending_invite_token') || '';
        } catch { }
      }
      if (!effectiveToken) {
        router.push('/');
        return;
      }

      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();

      if (!userData?.user) {
        try {
          localStorage.setItem('pending_invite_token', effectiveToken);
        } catch { }
        // Redirect to auth callback after login to ensure org and then come back to accept
        router.push(`/auth/login?next=${encodeURIComponent(`/accept-invite?token=${encodeURIComponent(effectiveToken)}`)}`);
        return;
      }

      const res = await fetch(`/api/organizations/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: effectiveToken }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Joined organization', { description: data.message });
        try { localStorage.removeItem('pending_invite_token'); } catch { }
        router.push('/dashboard');
      } else {
        toast.error('Error', { description: data.message });
        router.push('/');
      }
    };
    run();
  }, [token, router, toast]);

  return <div>Accepting invitation...</div>;
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AcceptInviteContent />
    </Suspense>
  );
}