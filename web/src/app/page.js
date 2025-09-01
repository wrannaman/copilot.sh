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
              🪩 Your AI memory for work calls.
            </h2>
            <p className="text-xl md:text-2xl text-foreground font-semibold leading-relaxed">
              Stop wasting hours on call notes. <span className="font-bold">Copilot.sh</span> records your conversations and turns them into actionable summaries ready for your CRM. Open‑source, private, and no bots required.
            </p>
            <p className="text-base md:text-lg text-muted-foreground mt-4 mb-10 leading-relaxed">
              For sales teams and founders who sell. Works on web and mobile. Your data stays with you.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild className="text-lg px-8 py-6">
                <Link href="/auth/login">
                  Join Early Access
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="text-lg px-8 py-6">
                <a href="https://github.com/wrannaman/copilot.sh" target="_blank" rel="noopener noreferrer">View on GitHub</a>
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
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Record</CardTitle>
                  <CardDescription>Capture any call or conversation with one tap on your phone or in your browser.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Digest</CardTitle>
                  <CardDescription>Get instant AI summaries, action items, and key insights.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Integrate</CardTitle>
                  <CardDescription>Push perfect call notes to HubSpot, Notion, or Slack in a single click.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Search</CardTitle>
                  <CardDescription>Instantly find any detail from past conversations. “What was their budget?”</CardDescription>
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
                  <CardDescription>CRC, offline retries, and exactly‑once assembly for reliable capture.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Privacy by design</CardTitle>
                  <CardDescription>One‑tap mute, delete sessions, and redact sensitive text. Your data stays with you.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Yours forever</CardTitle>
                  <CardDescription>Open‑source. Run on your hardware. Export anytime.</CardDescription>
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
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Record in browser</CardTitle><CardDescription>One‑click capture in the browser or on mobile.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Calendar context</CardTitle><CardDescription>Sessions auto‑tagged to Google Calendar events.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Agents</CardTitle><CardDescription>Automate: summarize, remind, email, or push to Notion/Docs.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Integrations</CardTitle><CardDescription>HubSpot, Notion, Slack (more coming).</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">Semantic search</CardTitle><CardDescription>Ask natural questions and get instant answers.</CardDescription></CardHeader></Card>
              <Card className="border-border/50"><CardHeader className="pb-2"><CardTitle className="text-lg">MCP server</CardTitle><CardDescription>Query your memory from inside ChatGPT.</CardDescription></CardHeader></Card>
            </div>
          </div>
        </section>

        {/* Agents */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Agents</h3>
              <p className="text-lg text-muted-foreground">Your OS for work + life.</p>
            </div>
            <div className="max-w-3xl mx-auto">
              <Card className="border-border/50">
                <CardContent className="pt-6 text-foreground">
                  <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
                    <li>Every evening → summarize my day → email me a digest.</li>
                    <li>After each meeting → draft a follow‑up → save to Gmail drafts.</li>
                    <li>Whenever I say “let’s do X” → create a task in Linear.</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Why Copilot.sh */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Why Copilot.sh</h3>
            </div>
            <div className="max-w-5xl mx-auto overflow-x-auto">
              <table className="w-full text-left text-sm md:text-base">
                <thead>
                  <tr className="border-b border-border/50 text-muted-foreground">
                    <th className="py-3 pr-4">Feature</th>
                    <th className="py-3 pr-4">Copilot.sh</th>
                    <th className="py-3">Meeting Bots (Otter, etc.)</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/30">
                    <td className="py-3 pr-4">Intrusiveness</td>
                    <td className="py-3 pr-4"><span className="font-semibold">None.</span> You control recording.</td>
                    <td className="py-3">Bot joins your call.</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-3 pr-4">Workflow</td>
                    <td className="py-3 pr-4">Record → Integrate</td>
                    <td className="py-3">Record → Copy/Paste</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-3 pr-4">Ownership</td>
                    <td className="py-3 pr-4"><span className="font-semibold">Yours forever</span> (Open‑source)</td>
                    <td className="py-3">Vendor lock‑in</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4">Cost</td>
                    <td className="py-3 pr-4">Free (Self‑hosted)</td>
                    <td className="py-3">Subscription fee</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Vision */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Our Vision: An Always‑On Future</h3>
            </div>
            <div className="max-w-3xl mx-auto text-center text-muted-foreground">
              <p>
                Were starting with a seamless software experience for mobile and desktop. In the future, we plan to
                release an optional, open‑source hardware puck that can provide continuous, ambient capture for a truly
                always‑on AI memory. Stay tuned.
              </p>
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
              <h3 className="text-4xl font-bold text-foreground mb-6">Never forget. Never lose. Always yours.</h3>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" asChild className="text-lg px-12 py-6">
                  <Link href="/auth/login">Join Early Access<ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="text-lg px-12 py-6">
                  <a href="https://github.com/copilotsh/copilot.sh" target="_blank" rel="noopener noreferrer">Star on GitHub</a>
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