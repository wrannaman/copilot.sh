export const metadata = {
  title: "Privacy Policy - Copilot.sh",
  description: "How Copilot.sh collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2025</p>

      <div className="prose prose-neutral dark:prose-invert mt-8">
        <p>
          Copilot.sh is a transcription product that records or ingests audio you
          provide and turns it into text and helpful summaries/action items. This
          policy explains what we collect, why we collect it, and how we handle it.
        </p>

        <h2 id="data-we-collect">Data we collect</h2>
        <ul>
          <li>Account information (email, name if provided).</li>
          <li>Audio you record or upload and the resulting transcriptions.</li>
          <li>Derived content like summaries, action items, and embeddings.</li>
          <li>Usage data for diagnostics and product improvement.</li>
        </ul>

        <h2 id="how-we-use-data">How we use your data</h2>
        <ul>
          <li>To provide transcription and related features you request.</li>
          <li>To improve accuracy, reliability, and overall product quality.</li>
          <li>To secure the service, prevent abuse, and comply with legal obligations.</li>
          <li>To communicate important service updates.</li>
        </ul>

        <h2 id="storage-and-retention">Storage and retention</h2>
        <p>
          Audio files, transcripts, and derived outputs are stored in our
          infrastructure (for example, Supabase storage and databases) and are
          retained for as long as your account remains active or as needed to
          operate the service. You can request deletion at any time.
        </p>

        <h2 id="sharing">Sharing</h2>
        <p>
          We do not sell your data. We may share data with service providers who
          help us run Copilot.sh (e.g., hosting, storage, analytics) under
          agreements that require them to protect your information.
        </p>

        <h2 id="security">Security</h2>
        <p>
          We use industry-standard security practices to protect your data. No
          method of transmission or storage is 100% secure, but we work to keep
          your information safe.
        </p>

        <h2 id="your-rights">Your rights</h2>
        <ul>
          <li>Access, export, or delete your data.</li>
          <li>Update your account information.</li>
          <li>Contact us with privacy questions or concerns.</li>
        </ul>

        <h2 id="contact">Contact</h2>
        <p>
          Questions? Email <a href="mailto:privacy@copilot.sh">privacy@copilot.sh</a>.
        </p>
      </div>
    </main>
  );
}


