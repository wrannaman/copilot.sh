"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModeToggle } from "@/components/mode-toggle";
import { useAuth } from "@/hooks/use-auth";
import { PublicOnly } from "@/components/auth-guard";
import { Shield, ArrowRight, Play, CheckCircle2, ShieldCheck, Sparkles, Gift } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

function HomeContent() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [showDemo, setShowDemo] = useState(false);

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
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Secreq</h1>
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
              Complete vendor security questionnaires in <span className="text-primary">minutes</span>
            </h2>
            <p className="text-xl md:text-2xl text-foreground font-semibold leading-relaxed">
              AI-powered workbench that preserves formatting! No More Copy Paste! $1 per question we help with.
            </p>
            <div className="mt-4 mb-6 flex flex-wrap items-center justify-center gap-2">
              <Badge variant="outline">No seats</Badge>
              <Badge variant="outline">No contracts</Badge>
              <Badge variant="outline">Self‑serve</Badge>
              <Badge variant="outline">Made + hosted in USA 🇺🇸</Badge>
            </div>
            <p className="text-base md:text-lg text-muted-foreground mb-8 leading-relaxed">Upload, collaborate, export. Your Excel format stays intact.</p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Button size="lg" asChild className="text-lg px-8 py-6">
                <Link href="/auth/login">
                  Start Free
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-lg px-8 py-6 group"
                onClick={() => setShowDemo(true)}
              >
                <Play className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                Watch Demo
              </Button>
            </div>

            <div className="mt-2">
              <a
                href="https://cal.com/andrew-pierno/30min"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Want to chat? Book a call
              </a>
            </div>

            {/* Demo Video */}
            <div className="relative max-w-4xl mx-auto">
              <div className="relative rounded-lg overflow-hidden shadow-2xl border border-border/50">
                {/* Mask tiny white line at the top of the video */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-background z-10" />
                <video
                  className="w-full h-auto"
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster="/workbench-min.png"
                >
                  <source src="/demo.mp4" type="video/mp4" />
                  {/* Fallback to GIF if video doesn't work */}
                  <Image
                    src="/demo.gif"
                    alt="Secreq Demo - AI filling out security questionnaires"
                    width={1200}
                    height={675}
                    className="w-full h-auto"
                  />
                </video>
              </div>
            </div>
          </div>
        </section>

        {/* See it in action */}
        <section className="py-16">
          <div className="container mx-auto px-6">
            <div className="text-center mb-10">
              <h3 className="text-3xl font-bold text-foreground">See it in action</h3>
              <p className="text-muted-foreground mt-2">A quick look at the core screens</p>
            </div>
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-border/50 overflow-hidden">
                <div className="relative bg-background">
                  <Image
                    src="/add-data.gif"
                    alt="Secreq Demo - AI filling out security questionnaires"
                    width={1200}
                    height={675}
                    className="w-full h-auto"
                  />
                </div>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Create an Answer Bank</CardTitle>
                  <CardDescription>Upload your policies and past answers to power precise drafts with citations.</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-border/50 overflow-hidden">
                <div className="relative">
                  <Image
                    src="/dash-min.png"
                    alt="Dashboard overview"
                    width={1200}
                    height={675}
                    className="w-full h-auto"
                  />
                </div>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Dashboard</CardTitle>
                  <CardDescription>Track questionnaires, status, and progress at a glance.</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-border/50 overflow-hidden">
                <div className="relative">
                  <Image src="/workbench-min.png" alt="AI Workbench formatting preserved" width={1200} height={675} className="w-full h-auto" />
                </div>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">AI Workbench</CardTitle>
                  <CardDescription>Draft answers in a spreadsheet UI while preserving Excel formatting.</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-border/50 overflow-hidden">
                <div className="relative">
                  <Image src="/team-min.png" alt="Add your team" width={1200} height={675} className="w-full h-auto" />
                </div>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">Add your Team</CardTitle>
                  <CardDescription>Invite collaborators and work together with assignments and review.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>
        {/* Why teams say “yes” to Secreq */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground mb-4">Why teams say “yes” to Secreq</h3>
            </div>
            <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-5 w-5 text-primary" /> 10–50× faster</CardTitle>
                  <CardDescription>AI suggests answers from your policies. You review and approve in a collaborative workbench.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-xl"><ShieldCheck className="h-5 w-5 text-primary" /> Excel format preserved</CardTitle>
                  <CardDescription>Upload your customer&apos;s Excel file. We preserve the exact formatting, complex structures, and export it back perfectly.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-xl"><CheckCircle2 className="h-5 w-5 text-primary" /> Team collaboration</CardTitle>
                  <CardDescription>Spreadsheet‑style <span className="font-medium text-foreground">AI Workbench</span> with comments, assignments, and bulk actions. Multiple people can work together.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-xl"><CheckCircle2 className="h-5 w-5 text-primary" /> Usage‑based pricing</CardTitle>
                  <CardDescription>Pay <span className="font-medium text-foreground">$1 per question</span> we help with. First 3 questionnaires are on us.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="sm:col-span-2 lg:col-span-1 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-5 w-5 text-primary" /> AI with citations</CardTitle>
                  <CardDescription>Every suggested answer shows exactly which documents it came from, with confidence scores.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Who it&apos;s for</h3>
            </div>
            <ul className="max-w-4xl mx-auto space-y-4 text-lg text-muted-foreground">
              <li>Teams getting hit with <span className="font-semibold text-foreground">customer security questionnaires</span> and due‑diligence forms.</li>
              <li>Founders who sell <span className="font-semibold text-foreground">before</span> they hire a full GRC team.</li>
              <li>Security/Compliance folks who are <span className="font-semibold text-foreground">done</span> re‑answering the same questions.</li>
            </ul>
            <p className="max-w-3xl mx-auto text-center text-lg text-muted-foreground mt-6">If that&apos;s you, this pays for itself on day one.</p>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground mb-2">How it works (under 10 minutes)</h3>
            </div>
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <Badge variant="secondary" className="mb-2">Step 1</Badge>
                  <CardTitle className="text-lg">Upload your docs</CardTitle>
                  <CardDescription>Policies, SOC 2/ISO docs, past questionnaires. Upload once; keep your knowledge base updated over time.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <Badge variant="secondary" className="mb-2">Step 2</Badge>
                  <CardTitle className="text-lg">Upload the Excel questionnaire</CardTitle>
                  <CardDescription>Drop in your customer&apos;s Excel file. We preserve the exact formatting, complex structures, and conditional logic.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <Badge variant="secondary" className="mb-2">Step 3</Badge>
                  <CardTitle className="text-lg">Collaborate in the Workbench</CardTitle>
                  <CardDescription>AI suggests answers with citations. Your team reviews, edits, comments, and assigns questions in a spreadsheet-like interface.</CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-border/50">
                <CardHeader className="pb-2">
                  <Badge variant="secondary" className="mb-2">Step 4</Badge>
                  <CardTitle className="text-lg">Export with original formatting</CardTitle>
                  <CardDescription>Download the completed Excel file with your original formatting intact, or export to CSV.</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

        {/* The offer */}
        <section className="bg-muted/30 py-16">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground mb-4">Our Offer</h3>
            </div>

            <div className="max-w-5xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left column - Core + Pricing */}
                <div>
                  <Card className="p-6">
                    <h4 className="text-xl font-semibold text-foreground mb-4">Core</h4>
                    <ul className="space-y-3 mb-6">
                      <li className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-sm">AI suggests answers using <em>your</em> docs</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-sm"><strong>Collaborative Workbench</strong> preserves Excel format</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-sm">Unlimited teammates, no seat pricing</span>
                      </li>
                    </ul>

                    <div className="border-t pt-6">
                      <h4 className="text-xl font-semibold text-foreground mb-3">Pricing</h4>
                      <div className="text-3xl font-bold text-primary mb-1">$1 <span className="text-base font-normal text-muted-foreground">per question</span></div>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          <span><strong>First 3 questionnaires free</strong></span>
                        </li>
                        <li className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          <span>Never pay for blanks or questions we can&apos;t help with</span>
                        </li>
                      </ul>
                    </div>
                  </Card>
                </div>

                {/* Right column - Bonuses + Guarantee */}
                <div className="space-y-6">
                  <Card className="p-6">
                    <h4 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                      <Gift className="h-5 w-5 text-primary" />
                      Launch Bonuses
                    </h4>
                    <ul className="space-y-3 text-sm">
                      <li><strong>Import Assist:</strong> We help ingest your policy docs</li>
                      <li><strong>Answer Library:</strong> SOC 2, ISO 27001, CAIQ mappings</li>
                      <li><strong>Style Guardrails:</strong> Tone/term config for your voice</li>
                    </ul>
                  </Card>

                  <Card className="p-6 border-primary/20">
                    <h4 className="text-lg font-semibold text-foreground mb-3">Simple Guarantee</h4>
                    <p className="text-sm text-muted-foreground mb-4">If your first draft isn&apos;t faster than manual work, keep the <strong>3 free questionnaires</strong> and walk away.</p>
                    <Button size="lg" asChild className="w-full">
                      <Link href="/auth/login">Start Free <ArrowRight className="ml-2 h-4 w-4" /></Link>
                    </Button>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What makes Secreq different */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">What makes Secreq different</h3>
            </div>
            <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 text-muted-foreground text-lg">
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">1) Excel format preservation</h4>
                <p>Most tools break your customer&apos;s Excel formatting. We <span className="font-semibold text-foreground">preserve every detail</span>—complex structures, conditional logic, styling—and export it back perfectly.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">2) Collaborative, not automated</h4>
                <p>We don&apos;t auto-fill questionnaires. Our <span className="font-semibold text-foreground">Workbench</span> lets your team review, edit, comment, and assign questions together with AI assistance.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">3) AI with citations</h4>
                <p>Every suggested answer shows <span className="font-semibold text-foreground">citations to your source docs</span> and a <span className="font-semibold text-foreground">confidence score</span>. No black box, no hallucinations.</p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground">4) Pay only for help</h4>
                <p>You pay <span className="font-semibold text-foreground">only</span> for questions where we provide AI suggestions. If we can&apos;t help or you leave it blank, no charge.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Security & privacy */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Security & privacy</h3>
            </div>
            <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-border/50">
                <CardContent className="pt-6 text-lg text-muted-foreground flex gap-3"><ShieldCheck className="h-6 w-6 text-primary mt-1" /> <span><span className="font-semibold text-foreground">Your data stays your data.</span> Content is <span className="font-semibold text-foreground">encrypted in transit and at rest</span> and <span className="font-semibold text-foreground">never used to train</span> shared models. It’s only used to answer <em>your</em> questions.</span></CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="pt-6 text-lg text-muted-foreground flex gap-3"><ShieldCheck className="h-6 w-6 text-primary mt-1" /> <span><span className="font-semibold text-foreground">Scoped access.</span> Role‑based access; least‑privilege by default.</span></CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="pt-6 text-lg text-muted-foreground flex gap-3"><ShieldCheck className="h-6 w-6 text-primary mt-1" /> <span><span className="font-semibold text-foreground">Data residency requests</span> available for regulated teams.</span></CardContent>
              </Card>
              <Card className="border-border/50">
                <CardContent className="pt-6 text-lg text-muted-foreground flex gap-3"><ShieldCheck className="h-6 w-6 text-primary mt-1" /> <span>Roadmap: <span className="font-semibold text-foreground">SOC 2</span> and <span className="font-semibold text-foreground">customer‑managed keys (BYOK)</span> are in progress—join the waitlist if that matters today.</span></CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Secreq vs. the alternatives */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">Secreq vs. the alternatives</h3>
            </div>
            <div className="max-w-4xl mx-auto space-y-8 text-lg text-muted-foreground">
              <div>
                <p className="font-semibold text-foreground">Vanta/Conveyor/Loopio</p>
                <p>Great suites, but they break Excel formatting and require long rollouts. <span className="font-semibold text-foreground">Secreq</span> preserves your customer&apos;s exact formatting and works instantly—perfect for ad-hoc questionnaires.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Internal wiki + copy/paste</p>
                <p>Inconsistent, slow, and you lose formatting when copying between Excel files. Secreq maintains perfect formatting while speeding up the research.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Freelancers/consultants</p>
                <p>Helpful, but they still read your docs line‑by‑line and often mess up complex Excel formatting. Secreq gives them AI-powered research while preserving the format.</p>
              </div>
            </div>
          </div>
        </section>



        {/* FAQs */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h3 className="text-3xl font-bold text-foreground">FAQs</h3>
            </div>
            <div className="max-w-4xl mx-auto space-y-8 text-lg">
              <div>
                <p className="font-semibold text-foreground">What file types can I upload?</p>
                <p className="text-muted-foreground">Policies as PDF/DOCX/Markdown; questionnaires as CSV/XLSX/GS. Portal exports work fine.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">What if a question needs custom info?</p>
                <p className="text-muted-foreground">Mark it <span className="font-semibold text-foreground">Needs Info</span> or assign an owner. You’re only billed for drafted answers.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">How accurate are the answers?</p>
                <p className="text-muted-foreground">We retrieve from your docs and show <span className="font-semibold text-foreground">citations + confidence</span>. You approve every answer.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Do you store our questionnaires?</p>
                <p className="text-muted-foreground">Yes, inside your account for reuse and audit trail. You can export everything anytime.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Will you train on our data?</p>
                <p className="text-muted-foreground">No. Your documents are used solely to serve your workspace.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Do you integrate with GRC platforms?</p>
                <p className="text-muted-foreground">CSV/XLSX covers most pipelines today. Direct integrations are on the roadmap—tell us what you need.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">What if we can’t upload documents due to policy?</p>
                <p className="text-muted-foreground">Use <span className="font-semibold text-foreground">Redacted Mode</span> (paste only what’s needed) or join the <span className="font-semibold text-foreground">Local/CLI waitlist</span> for on‑prem processing.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-muted/30 py-20">
          <div className="container mx-auto px-6 text-center">
            <div className="max-w-3xl mx-auto">
              <h3 className="text-4xl font-bold text-foreground mb-6">Stop losing weeks to copy‑paste. <span className="text-primary">Upload your next questionnaire and watch Secreq draft it in minutes.</span></h3>
              <p className="text-xl text-muted-foreground mb-8">$1 per question. First 3 questionnaires free.</p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" asChild className="text-lg px-12 py-6">
                  <Link href="/auth/login">Start Free<ArrowRight className="ml-2 h-5 w-5" /></Link>
                </Button>
                <Button size="lg" variant="outline" className="text-lg px-12 py-6" onClick={() => setShowDemo(true)}>
                  <Play className="mr-2 h-5 w-5" /> Watch 90‑sec Demo
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 bg-background">
        <div className="container mx-auto px-6 py-8 text-center text-sm text-muted-foreground">
          <p>© Secreq. AI‑powered security questionnaires made simple.</p>
        </div>
      </footer>

      {/* Demo Video Modal */}
      <Dialog open={showDemo} onOpenChange={setShowDemo}>
        <DialogContent className="max-w-4xl w-full p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Secreq Demo Video</DialogTitle>
          </DialogHeader>
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <video
              className="w-full h-full"
              controls
              autoPlay
              muted
              playsInline
              preload="metadata"
            >
              <source src="/demo.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </DialogContent>
      </Dialog>
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