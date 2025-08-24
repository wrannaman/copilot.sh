
# copilot.sh

> Humane Pin raised $200M. This is the open-source version you actually own.  
> 🪩 Always-on AI memory for work + life.

---

## What is copilot.sh?

**copilot.sh** is an **open-source ambient AI recorder**.  
Capture conversations → tag with Google Calendar → filter with custom prompts → push to Notion/Docs → search everything later. Uses nextjs as a front end and supabase backend.

### ✨ Features
- 🎙️ **Record in browser** (or run on a Raspberry Pi puck)  
- 📅 **Calendar context** → sessions linked to your Google events  
- 🧹 **Prompt filters** → structure transcripts into summaries, todos, commitments  
- 🗂️ **Push outputs** → Notion or Google Docs  
- 🔍 **RAG search** → semantic + keyword recall across your life, filtered by calendar  
- 🔌 **MCP server** → query your memory from inside ChatGPT  
- 🛠️ **Open source** → MIT licensed, self-host or extend it however you want  

---

## Why?

Most “AI memory” tools are closed, expensive, or creepy.  
- Otter/Granola → only work on Zoom/Meet.  
- Rewind → Mac-only, closed.  
- Humane Pin → $699 + subscription.  

**copilot.sh** is:  
- 🔓 Open source  
- 💸 Free to run yourself  
- 🖥️ Hackable → runs on a Pi, browser, or your own infra  
- 🔒 Privacy first → you own the data  

---

## Quick Start

### 1. Clone + Install

```bash
cp .env.example .env
```

.env.example has the variables you need to set.

```bash
npm i && npm run dev 
```


