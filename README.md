# copilot.sh

Your open-source AI memory for every conversation....

🪩 Record, summarize, and search your most important calls and meetings.

<br/>

<img src="https://user-images.githubusercontent.com/your_image_path/app_promo_graphic.png" alt="Screenshot or GIF of the app in action" width="800"/>

---

## What is copilot.sh?

Copilot.sh is an open-source AI tool that records your important conversations and turns them into a private, searchable memory. It's designed for busy founders, sales professionals, and anyone who wants to stop taking notes and start focusing on the discussion.

Unlike other tools, it doesn't intrusively join your calls as a bot. You are always in control.
t5
---

## Key Features

- 📱 **Mobile & Web Apps**: Capture conversations anywhere with our iOS, Android, and Web apps.
- 🔒 **Private by Design**: Your data is yours. Use our secure cloud or self-host for complete control.
- ✨ **Instant AI Summaries**: Turn hours of talk into actionable notes, key insights, and to-do items.
- 🔍 **Powerful Search**: Instantly find what was said, by whom, and when across all your conversations.
- 📅 **Calendar Context**: Automatically tags recordings to your Google Calendar events.
- 🔌 **Seamless Integrations**: Push notes to HubSpot, Notion, Slack, Google Docs, and more.

---

## 🚀 Get Started Instantly (The Easy Way)

### 1) Cloud Version (Recommended)
The easiest way to get started. Sign up in 30 seconds and start recording.

➡️ Try Copilot.sh Cloud for free

### 2) Mobile Apps
Capture conversations on the go.

➡️ Download on the App Store • ➡️ Get it on Google Play

---

## 🔧 Self-Hosting & Development Setup

For those who want to run copilot.sh on their own infrastructure.

### Prerequisites

- Node.js 18+
- Supabase account (free tier is sufficient)
- Google Cloud Platform account (for Speech-to-Text API)
- Docker (for easiest deployment)

### 1) Supabase Schema (run one SQL file)
In your Supabase project, open the SQL Editor and run the contents of `web/sql/001-initial.sql`. This creates the database tables, RLS policies, and storage bucket.

Then configure Auth:
- Set Site URL to `http://localhost:3000`
- Add Redirect URL `http://localhost:3000/auth/callback`

### 2) Configure Environment
Clone the repository. Create a `.env` file in `web` (and `worker` if you're running it) and fill in your Supabase and Google Cloud credentials.

Required values:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Anon/public key)
- `SUPABASE_SERVICE_ROLE` (server-only)
- Optional: `GOOGLE_APPLICATION_CREDENTIALS` (file path or JSON string) if using server-side transcription

Mobile app credentials:
- Open the mobile app → `Settings` → enter your Supabase URL and Anon key (these map to `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON` under the hood).

### 3) Run with Docker
The simplest way to run the entire stack (web app + worker).

```bash
# Edit docker-compose.yml with your .env variables
docker-compose up --build
```

Your app will be available at http://localhost:3000.

For a more detailed manual setup guide, see `SELF_HOSTING.md` (coming soon).

---

### 4) WhisperX (Optional) – Diarization

WhisperX adds fast ASR with word-level timestamps and speaker diarization (via pyannote). This runs alongside Google Speech in the worker so you can compare both outputs.

Setup (recommended: fresh Python 3.11 env):

```bash
# Create a clean env (conda shown; venv works too)
conda create -n whisperx311 python=3.11 -y
conda activate whisperx311

# Install ASR + diarization dependencies
pip install -U whisperx "pyannote-audio>=3.3.2" "pyannote-pipeline>=3.0.1" speechbrain

# Required for diarization
export HUGGING_FACE_HUB_TOKEN="<your_hf_token>"
# In browser (once), accept model licenses while logged in:
# - pyannote/segmentation
# - pyannote/Speaker-Diarization-3.1
```

Quick test with a WAV file:

```bash
python whisper/whisperx_transcribe.py /path/to/audio.wav
```

Worker integration:

- EITHER export the Python path before starting the worker:

```bash
export WHISPERX_PYTHON="/path/to/your/env/bin/python"
node worker/index.js
```

- OR edit `worker/lib/audio.js` to point `pythonBin` at your env’s python (no env var needed).

Outputs and where to find them:

- Storage bucket `copilot.sh`:
  - `transcripts/<org_id>/<session_id>.whisperx.json` (structured WhisperX output)
  - `transcripts/<org_id>/<session_id>.whisperx.txt` (plain text from WhisperX)
- Database (`sessions`):
  - `whisperx_json_path`, `whisperx_text_path`
  - `whisperx_status` (running|done|error), `whisperx_started_at`, `whisperx_error`

Signed URLs for quick copy/paste are logged in the worker when files are uploaded.

Troubleshooting:

- If you see NumPy 2.x vs compiled deps errors (SciPy/Matplotlib), use a clean Python 3.11 env as above.
- Ensure the Hugging Face token is set if you want diarization; without it, WhisperX will skip speaker labeling.


## 🤔 Why Copilot.sh?

Most AI meeting tools are intrusive, closed-source, or both. We built a better way.

| Feature | Copilot.sh | Meeting Bots (Otter, Fathom, etc.) |
|---|---|---|
| Intrusiveness | ✅ None. You control recording. | ❌ Bot joins your call. |
| Data Ownership | ✅ Yours forever. Open-source. | ❌ Vendor lock-in. |
| Privacy | ✅ Private by design. Self-host option. | ❌ Cloud-only. |
| Flexibility | ✅ Runs anywhere. Mobile, web, desktop. | ❌ Browser-based meetings only. |

---

## 🗺️ Roadmap

We're just getting started. Here's what's on the horizon:

- Desktop Apps: Native clients for macOS, Windows, and Linux.
- Advanced Agents: Build more complex, trigger-based workflows.
- Team Features: Shared spaces and collaboration tools.
- Raspberry Pi Puck: An optional, open-source hardware device for ambient, always-on recording.

---

## 🤝 Contributing

We love contributions! Please open issues and pull requests to help improve the project. A formal contributing guide will be added soon.

---

## 📄 License

Source-available under **BUSL 1.1**.

- ✅ Free for personal and self-hosted use.
- ❌ No hosting/resale as a competing SaaS without a license.
- 🔓 Converts to Apache 2.0 after 4 years.

See `LICENSE.md` for the full text.
