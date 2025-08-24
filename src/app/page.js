"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuth } from "@/hooks/use-auth";
import { PublicOnly } from "@/components/auth-guard";
import { ArrowRight, CircleDot } from "lucide-react";
import Link from "next/link";

function HomeContent() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CircleDot className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Copilot.sh</h1>
          </div>
          <div className="flex items-center gap-4">
            <ModeToggle />
            <Button asChild variant="outline">
              <Link href="/auth/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero Section */}
        <section className="container mx-auto px-6 py-20 text-center">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-5xl md:text-6xl font-bold text-foreground mb-6 tracking-tight">
              Your life. Recorded. Searchable. <span className="text-primary">Yours.</span>
            </h2>
            <p className="text-xl md:text-2xl text-foreground font-semibold leading-relaxed">
              Copilot.sh is an open-source always-on recorder for work and life. Record in browser, sync with Google Calendar, and push structured digests to Notion or Google Docs.
            </p>
            <p className="text-base md:text-lg text-muted-foreground mt-4 mb-10 leading-relaxed">
              Humane Pin raised $200M — this one runs on a $40 Pi or your laptop.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild className="text-lg px-8 py-6">
                <Link href="/auth/login">
                  Get Early Access
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="text-lg px-8 py-6">
                <a href="https://github.com/copilotsh/copilot.sh" target="_blank" rel="noopener noreferrer">View on GitHub</a>
              </Button>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-16">
          <div className="container mx-auto px-6">
            <div className="text-center mb-10">
              <h3 className="text-3xl font-bold text-foreground">How it works</h3>
            </div>
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Record</CardTitle>
                  <CardDescription>Capture conversations in browser, mobile, or on a $40 Raspberry Pi puck.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Digest</CardTitle>
                  <CardDescription>AI filters transcripts into summaries, action items, and commitments.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Push & Recall</CardTitle>
                  <CardDescription>Auto-sync to Notion/Docs, or search your memory with calendar context.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* Reliability, safety, and ownership */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Reliability, safety, and ownership</h3>
            </div>
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Zero‑loss recording</CardTitle>
                  <CardDescription>Chunked uploads with CRC + content‑hash, sequence numbers, and offline retry. Exactly‑once assembly server‑side.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Privacy controls</CardTitle>
                  <CardDescription>One‑tap mute/pause, delete sessions, optional redaction hooks. Your data, your rules.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Yours to own</CardTitle>
                  <CardDescription>MIT‑licensed. Run on a $40 Pi or your laptop. Export anytime.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Features</h3>
            </div>
            <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Browser Recording</CardTitle><CardDescription>no setup, just press record.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Google Calendar Integration</CardTitle><CardDescription>tag sessions automatically to meetings.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Custom Workflows</CardTitle><CardDescription>drag-and-drop: transcript → prompt filter → Notion/Docs/Email.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Semantic Search</CardTitle><CardDescription>“what did I promise John last week?” → instant answer.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Notion & Google Docs Sync</CardTitle><CardDescription>push digests where you work.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Privacy by Design</CardTitle><CardDescription>open-source, local control, hard deletes.</CardDescription></CardHeader></Card>
            </div>
          </div>
        </section>

        {/* Why Copilot.sh */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Why Copilot.sh</h3>
            </div>
            <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 text-lg text-muted-foreground">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle>Copilot.sh</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="list-disc pl-5 space-y-2">
                    <li>$40 hardware / free OSS</li>
                    <li>Yours forever</li>
                    <li>Private & local</li>
                    <li>Extensible workflows</li>
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle>Humane Pin / Otter.ai</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="list-disc pl-5 space-y-2">
                    <li>$699 + subscription</li>
                    <li>Locked to vendor</li>
                    <li>Cloud-first</li>
                    <li>Limited flexibility</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Open Source */}
        <section className="py-16">
          <div className="container mx-auto px-6">
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-lg text-muted-foreground">Open Source</p>
              <div className="mt-2 text-foreground">• MIT License • Built with Supabase + Whisper</div>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" asChild className="text-lg px-8 py-6">
                  <Link href="/auth/login">Join Early Access<ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="text-lg px-8 py-6">
                  <a href="https://github.com/copilotsh/copilot.sh" target="_blank" rel="noopener noreferrer">Star on GitHub</a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6 text-center">
            <div className="max-w-3xl mx-auto">
              <h3 className="text-4xl font-bold text-foreground mb-6">Never forget a meeting again.</h3>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" asChild className="text-lg px-12 py-6">
                  <Link href="/auth/login">Join Early Access<ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="text-lg px-12 py-6">
                  <a href="https://github.com/copilotsh/copilot.sh" target="_blank" rel="noopener noreferrer">View on GitHub</a>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 bg-background">
        <div className="container mx-auto px-6 py-8 text-center text-sm text-muted-foreground">
          <p>© Copilot.sh. Open‑source always‑on memory for your work.</p>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <PublicOnly redirectTo="/dashboard">
      <HomeContent />
    </PublicOnly>
  );
}