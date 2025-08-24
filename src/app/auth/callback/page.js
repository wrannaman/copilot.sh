"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/toast-provider';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    const handleAuthCallback = async () => {
      const supabase = createClient();

      try {
        console.log("Processing auth callback...");

        // Get URL parameters
        const code = searchParams.get('code');
        const error_code = searchParams.get('error');
        const error_description = searchParams.get('error_description');


        // Handle OAuth errors first
        if (error_code) {
          console.error('OAuth error:', error_code, error_description);
          toast.error("Authentication failed", {
            description: error_description || "OAuth authentication failed"
          });
          router.push('/auth/login');
          return;
        }

        if (code) {
          console.log("Exchanging code for session...");

          try {
            // Try PKCE flow first, fallback to implicit flow
            const { data, error } = await supabase.auth.exchangeCodeForSession(code);
            // If PKCE fails, the session might already be set by the auth state listener
            if (error && error.message.includes('code verifier')) {
              console.log("PKCE failed, checking if session already exists...");
              const { data: sessionData } = await supabase.auth.getSession();
              if (sessionData.session) {
                console.log("Session already exists, redirecting to dashboard");
                toast.success("Successfully logged in!", {
                  description: `Welcome ${sessionData.session.user.email}!`
                });
                router.push('/dashboard');
                return;
              }
            }

            if (data?.session?.user) {
              console.log("✅ Authentication successful:", data.session.user);
              toast.success("Successfully logged in!", {
                description: `Welcome ${data.session.user.email}!`
              });
              // If there is a pending invite, auto-accept it now
              try {
                const pendingToken = typeof window !== 'undefined' ? localStorage.getItem('pending_invite_token') : null;
                if (pendingToken) {
                  await fetch('/api/organizations/invites/accept', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: pendingToken })
                  })
                  localStorage.removeItem('pending_invite_token')
                }
              } catch { }
              router.push('/dashboard');
              return;
            }
          } catch (exchangeError) {
            console.log("Exchange failed, checking existing session:", exchangeError);
            // Check if user is already authenticated
            const { data: sessionData } = await supabase.auth.getSession();
            if (sessionData.session) {
              console.log("User already authenticated, redirecting...");
              router.push('/dashboard');
              return;
            }
          }

          if (error) {
            console.error('Auth exchange error:', error);
            toast.error("Authentication failed", {
              description: error.message || "Failed to complete authentication"
            });
            router.push('/auth/login');
            return;
          }

          if (data?.session?.user) {
            console.log("✅ Authentication successful:", data.session.user);
            toast.success("Successfully logged in!", {
              description: `Welcome ${data.session.user.email}!`
            });
            try {
              const pendingToken = typeof window !== 'undefined' ? localStorage.getItem('pending_invite_token') : null;
              if (pendingToken) {
                await fetch('/api/organizations/invites/accept', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: pendingToken })
                })
                localStorage.removeItem('pending_invite_token')
              }
            } catch { }
            router.push('/dashboard');
            return;
          }
        }

        // If we get here, something went wrong
        console.warn("No code found in callback URL");
        toast.error("Authentication failed", {
          description: "No authentication code found in callback URL"
        });
        router.push('/auth/login');

      } catch (error) {
        console.error('Auth callback error:', error);
        toast.error("Authentication failed", {
          description: "There was an issue processing your login."
        });
        router.push('/auth/login');
      } finally {
        setProcessing(false);
      }
    };

    handleAuthCallback();
  }, [searchParams, router, toast]);

  if (processing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Completing your login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AuthCallbackContent />
    </Suspense>
  );
}
