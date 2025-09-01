"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Loader2, Chrome } from "lucide-react";
import { createClient as createSupabaseClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);
  const { loginWithMagicLink, loginWithGoogle, isAuthenticated } = useAuth();
  const router = useRouter();
  const specialEmail = "apple@copilot.sh";
  const isReviewEmail = email.trim().toLowerCase() === specialEmail;
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const nextParam = searchParams?.get('next') || undefined;

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const handleMagicLink = async (e) => {
    e.preventDefault();

    if (!email.trim()) {
      return;
    }

    setIsMagicLinkLoading(true);

    try {
      await loginWithMagicLink(email, nextParam);
    } finally {
      setIsMagicLinkLoading(false);
    }
  };

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setIsPasswordLoading(true);
    try {
      const supabase = createSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      if (data?.session) {
        try {
          const pending = typeof window !== 'undefined' ? localStorage.getItem('pending_invite_token') : null;
          if (!nextParam && pending) {
            router.push(`/accept-invite?token=${encodeURIComponent(pending)}`);
            return;
          }
        } catch { }
        router.push(nextParam || '/dashboard');
      }
    } catch (err) {
      // No toast here to keep it simple; rely on default error surface if needed
      console.error('Password login failed', err?.message || err);
    } finally {
      setIsPasswordLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);

    try {
      await loginWithGoogle(nextParam);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-semibold text-foreground hover:text-foreground/80 transition-colors">
            Copilot.sh
          </Link>
          <ModeToggle />
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-4">
              Welcome to Copilot.sh
            </h1>
            <p className="text-muted-foreground">
              Sign in to access your security questionnaire workspace
            </p>
          </div>

          <Card className="border border-border bg-card">
            <CardHeader className="text-center">
              <CardTitle>Sign In</CardTitle>
              <CardDescription>
                Choose your preferred sign-in method
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Google Login */}
              <Button
                variant="outline"
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
              >
                {isGoogleLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in with Google...
                  </>
                ) : (
                  <>
                    <Chrome className="mr-2 h-4 w-4" />
                    Continue with Google
                  </>
                )}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or continue with email
                  </span>
                </div>
              </div>

              {/* Magic Link or Password (for review email) */}
              <form onSubmit={isReviewEmail ? handlePasswordLogin : handleMagicLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isMagicLinkLoading || isPasswordLoading}
                  />
                </div>

                {isReviewEmail && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isPasswordLoading}
                    />
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={(isReviewEmail ? (isPasswordLoading || !password) : isMagicLinkLoading) || !email.trim()}
                >
                  {isReviewEmail ? (
                    isPasswordLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>Sign In</>
                    )
                  ) : (
                    isMagicLinkLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending Magic Link...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Send Magic Link
                      </>
                    )
                  )}
                </Button>
              </form>

              <p className="text-xs text-muted-foreground text-center mt-4">
                Don&apos;t have an account? One will be created automatically when you sign in.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}