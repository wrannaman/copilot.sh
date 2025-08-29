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

## Quick Start

### Web

```bash
cd web
cp .env.example .env
npm i && npm run dev
