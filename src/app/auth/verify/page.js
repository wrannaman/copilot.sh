"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import { CheckCircle, XCircle, Loader2, ArrowLeft } from "lucide-react";

function VerifyContent() {
  const [status, setStatus] = useState("verifying"); // verifying, success, error
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyToken, user } = useAuth();

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }

    handleVerifyToken();
  }, [token]);

  const handleVerifyToken = async () => {
    if (!token) return;

    setStatus("verifying");

    const result = await verifyToken(token);

    if (result.success) {
      setStatus("success");
      // Redirect to dashboard after a short delay
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } else {
      setStatus("error");
    }
  };

  const handleRetry = () => {
    handleVerifyToken();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link
            href="/auth/login"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Login
          </Link>
          <ModeToggle />
        </div>

        {/* Verification Card */}
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center space-y-2">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
              {status === "verifying" && (
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                  <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
                </div>
              )}
              {status === "success" && (
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                </div>
              )}
              {status === "error" && (
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-red-600" />
                </div>
              )}
            </div>

            <CardTitle className="text-2xl font-bold">
              {status === "verifying" && "Verifying..."}
              {status === "success" && "Welcome Back!"}
              {status === "error" && "Verification Failed"}
            </CardTitle>

            <CardDescription className="text-base">
              {status === "verifying" && "Please wait while we verify your magic link"}
              {status === "success" && "You have been successfully signed in"}
              {status === "error" && "There was a problem with your verification link"}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {status === "verifying" && (
              <div className="text-center space-y-4">
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full animate-pulse" style={{ width: "60%" }}></div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Authenticating your account...
                </p>
              </div>
            )}

            {status === "success" && user && (
              <div className="space-y-4">
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Welcome back, <span className="font-medium">{user.email}</span>
                  </p>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Organization: <span className="font-medium">{user.orgName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Role: <span className="font-medium capitalize">{user.role}</span>
                    </p>
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-4">
                    Redirecting you to your dashboard...
                  </p>
                  <Button
                    onClick={() => router.push("/dashboard")}
                    className="w-full"
                  >
                    Continue to Dashboard
                  </Button>
                </div>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-4">
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {!token
                      ? "The verification link is missing a token."
                      : "The verification link may have expired or is invalid."
                    }
                  </p>
                </div>

                <div className="space-y-2">
                  {token && (
                    <Button onClick={handleRetry} className="w-full" variant="outline">
                      Try Again
                    </Button>
                  )}
                  <Button onClick={() => router.push("/auth/login")} className="w-full">
                    Request New Magic Link
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <VerifyContent />
    </Suspense>
  );
}