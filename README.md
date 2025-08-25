
# copilot.sh

> Humane Pin raised $200M. This is the open-source version you actually own.  
> 🪩 Always-on AI memory for work + life.

---

## What is copilot.sh?

**copilot.sh** is an **open-source ambient AI recorder**.  
Capture conversations → tag with Google Calendar → filter with custom prompts → push to Notion/Docs → search everything later. Uses nextjs as a front end and supabase backend.

- 🟢 Runs anywhere: browser, laptop, Raspberry Pi ($40 puck)  
- 🔒 Privacy: data stays with you, not us  
- 🛠 Hackable: bring your own LLM, extend with MCP plugins  
- 🌍 Community-driven: GitHub stars = roadmap  

### ✨ Features
- 🎙️ **Record in browser** (or run on a Raspberry Pi puck)  
- 📅 **Calendar context** → sessions linked to your Google events  
- 🧹 **Prompt filters** → structure transcripts into summaries, todos, commitments  
- 🗂️ **Push outputs** → Notion or Google Docs  
- 🔍 **RAG search** → semantic + keyword recall across your life, filtered by calendar  
- 🔌 **MCP server** → query your memory from inside ChatGPT  

## License

Copilot.sh is source-available under the **Business Source License 1.1 (BUSL)**.  
- ✅ Free for personal and self-hosted use.  
- ❌ Not allowed to sell or host as a paid service without a commercial license.  
- 🔓 Each release converts to Apache 2.0 after 4 years.  

See [LICENSE.md](./LICENSE.md) for details.


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
# create a google service account and download the credentials.json file into ./credentials/google.json
```

.env.example has the variables you need to set.

```bash
npm i && npm run dev 
```



### Google service account 
- Go to Google Cloud Console -> IAM & Admin -> Service Accounts 
  1. Create service account 
  2. Create key with Cloud Speech Client role 
  3. Skip permissions 
  4. Download the JSON file and put it in ./credentials/google.json

## Disclaimer

Copilot.sh records audio. Please use responsibly and comply with local laws around recording conversations.
