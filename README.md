# copilot.sh

> Humane Pin raised $200M. This is the open-source version you actually own.  
> 🪩 Always-on AI memory + agents for work + life.

---

## What is copilot.sh?

**copilot.sh** is an **open-source ambient AI recorder and agent platform.**  
It captures everything → organizes with calendar context → lets you build agents that act on your data.

- 🟢 **Runs anywhere**: browser, laptop, Raspberry Pi ($40 puck)  
- 🔒 **Private**: data stays with you, not us  
- 🛠 **Hackable**: bring your own LLM, extend with MCP plugins  
- ⚡ **Agentic**: create workflows that summarize, remind, email, or push to Notion/Docs  

---

## ✨ Features

- 🎙️ **Record in browser** (or run 24/7 on a Raspberry Pi puck)  
- 📅 **Calendar context** → sessions auto-tagged to Google events  
- 🧩 **Agents** → e.g. “Every evening, digest my day and email me a summary”  
- 🗂️ **Integrations** → Notion, Google Docs, Gmail (more coming)  
- 🔍 **Semantic Search** → “what did I promise in the last QBR?”  
- 🔌 **MCP server** → query your memory from inside ChatGPT  

---

## License

Source-available under **BUSL 1.1**:  
- ✅ Free for personal + self-hosted use.  
- ❌ No hosting/resale as SaaS without license.  
- 🔓 Converts to Apache 2.0 after 4 years.  

See [LICENSE.md](./LICENSE.md).

---

## Why?

Most “AI memory” tools are **closed, expensive, or creepy**:  
- Otter/Granola → meeting bots only  
- Rewind → Mac-only, closed  
- Humane Pin → $699 + subscription  

**copilot.sh** is:  
- 🔓 Open source  
- 💸 Free to run  
- 🖥️ Hackable (Pi, browser, or infra)  
- 🔒 Private — you own the data  

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** 
- **Google Cloud Platform account** (for Speech-to-Text API)
- **Supabase account** (free tier works)

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/copilot.sh
cd copilot.sh
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Settings** → **API** and copy your URL + service role key
3. Go to **Storage** → **Buckets** and create a bucket named `copilot.sh`
4. Run the database migration:

```bash
cd web
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npm run db:migrate  # or paste web/sql/001-initial.sql into SQL Editor
```

### 3. Set Up Google Cloud

You need Google Speech-to-Text API for transcription:

```bash
# 1. Create a GCP project at console.cloud.google.com
# 2. Enable Speech-to-Text API
# 3. Create a service account with Speech Client role
# 4. Download the JSON key file

# 5. Create a GCS bucket for temporary audio storage
gcloud config set project YOUR_PROJECT_ID
gsutil mb gs://copilot-audio-temp

# 6. Grant your service account permissions (replace with your service account email)
gsutil iam ch serviceAccount:YOUR_SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com:objectAdmin gs://copilot-audio-temp

# 7. Set lifecycle rule to auto-delete files after 1 day
echo '{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 1}}]}' > lifecycle.json
gsutil lifecycle set lifecycle.json gs://copilot-audio-temp
rm lifecycle.json
```

### 4. Configure Environment

Edit your `.env` files:

**web/.env:**
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE=your_service_role_key
GOOGLE_APPLICATION_CREDENTIALS='{"type":"service_account","project_id":"..."}'  # JSON key as string
GCS_BUCKET_NAME=copilot-audio-temp
```

**worker/.env:**
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url  
SUPABASE_SERVICE_ROLE=your_service_role_key
GOOGLE_APPLICATION_CREDENTIALS='{"type":"service_account","project_id":"..."}'  # Same JSON key
GCS_BUCKET_NAME=copilot-audio-temp
SUMMARY_MODEL_ID=gemini-2.0-flash-exp  # Optional: change AI model
```

### 5. Run the Stack

```bash
# Terminal 1: Web app
cd web
npm install
npm run dev  # http://localhost:3000

# Terminal 2: Worker (transcription + AI)
cd worker  
npm install
npm run dev  # Polls for new recordings

# Terminal 3: Raspberry Pi (optional)
cd rpi
python copilot.py  # Always-on recording
```

### 6. Test It

1. Go to `http://localhost:3000`
2. Sign up for an account
3. Go to **Record** → hit the red button → talk for 30+ seconds → stop
4. Check the worker logs - you should see GCS upload + transcription
5. Go to **Search** to find your transcript

---

## 🏗️ Architecture

- **Web**: Next.js app (recording UI, search, dashboard)
- **Worker**: Node.js background processor (transcription + AI)  
- **Database**: Supabase (sessions, transcripts, users)
- **Storage**: Supabase (audio chunks) + GCS (temp files for long audio)
- **AI**: Google Speech-to-Text + Gemini for summaries

---

## 🔧 Advanced Setup

### Calendar Integration

Connect Google Calendar to auto-tag recordings:

1. Go to **Integrations** → **Google Calendar**
2. Follow OAuth flow to connect your calendar
3. Recordings will auto-fill titles from nearby calendar events

### Raspberry Pi Always-On

Deploy to a Pi for 24/7 ambient recording:

```bash
# On your Pi
git clone https://github.com/yourusername/copilot.sh
cd copilot.sh/rpi
pip install -r requirements.txt

# Edit config
nano copilot.py  # Set your API endpoints

# Run
python copilot.py
```

### Docker Deployment

```bash
# Build and run with docker-compose
docker-compose up -d
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SERVICE_ROLE` | Supabase service role key | ✅ |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP service account JSON | ✅ |
| `GCS_BUCKET_NAME` | GCS bucket for temp audio | ✅ |
| `SUMMARY_MODEL_ID` | Gemini model for summaries | ❌ |
| `WORKER_POLL_INTERVAL_MS` | How often worker checks for jobs | ❌ |

---

## 🐛 Troubleshooting

### "The specified bucket does not exist"
- Create the GCS bucket: `gsutil mb gs://copilot-audio-temp`
- Make sure your service account has Storage Admin role

### "Inline audio exceeds duration limit"  
- This is normal for long recordings - the system auto-uploads to GCS
- Check your GCS bucket permissions and credentials

### Worker not processing recordings
- Check that both web and worker have the same Supabase credentials
- Verify the worker is running: `cd worker && npm run dev`
- Check worker logs for authentication errors

### No transcription results
- Verify Speech-to-Text API is enabled in GCP
- Check service account has Speech Client role
- Try a shorter test recording first

---

## 📚 More Documentation

- **API Reference**: See `web/src/app/api/` for endpoint docs
- **Database Schema**: See `web/sql/001-initial.sql`  
- **Deployment Guide**: See `docs/deployment.md` (coming soon)
- **Agent Development**: See `docs/agents.md` (coming soon)

---
