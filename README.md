# 🤖 Discord Persona Bot

A Discord bot powered by your choice of AI — Google Gemini, Groq, OpenAI, Anthropic, Mistral, Cohere, or Ollama — with a fully customizable persona, slash commands, authorized-user access control, persistent chat logs, custom memories per user, and AI image generation from a separate configurable provider.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🎭 **Custom persona** | Edit `persona.json` — no code changes needed |
| **Slash commands** | Full `/command` UI with autocomplete, typed options, and ephemeral replies |
| 🔐 **Authorized users only** | Silently ignores anyone not on your whitelist |
| 🤖 **7 chat providers** | Gemini, Groq, OpenAI, Anthropic, Mistral, Cohere, Ollama |
| 🎨 **4 image providers** | Gemini Imagen, Together AI, DALL-E 3, Stability AI — all separate from chat |
| 🔁 **Live model switching** | Switch provider or model mid-session with `/provider set` or `/model` |
| 🧠 **Persistent memories** | Per-user and global facts injected into every conversation |
| 💬 **Persistent chat log** | Every message saved to disk, searchable, and AI-queryable |
| 😀 **Custom app emojis** | Bot uses emojis you upload in the Developer Portal |
| 💬 **@mention / DM chat** | Natural free-form conversation still works via mentions and DMs |
| ☁️ **Railway-ready** | Zero config deployment |

---

## 📁 Project Structure

```
discord-persona-bot/
├── bot.js              Main bot
├── persona.json        Persona config (edit this)
├── package.json
├── railway.toml
├── .env.example
└── data/               Auto-created at runtime
    ├── authorized.json  Authorized user IDs
    ├── memories.json    Custom memories
    ├── state.json       Active provider/model (persisted)
    └── logs/
        └── <channelId>.jsonl  Per-channel chat logs
```

---

## 🚀 Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **Bot** tab → **Add Bot** → copy the **Token** → this is `DISCORD_TOKEN`
3. **General Information** tab → copy the **Application ID** → this is `CLIENT_ID`
4. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Read Message History`, `View Channels`, `Attach Files`, `Add Reactions`
6. Use the generated URL to invite the bot to your server

> **`applications.commands` scope is required for slash commands.** If you invited the bot before without it, re-invite using the new URL.

### 2. Get your API keys

| Provider | Free tier | Key location |
|---|---|---|
| **Groq** | ✅ Fully free | [console.groq.com/keys](https://console.groq.com/keys) |
| **Gemini** | ✅ Free tier | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Together AI** | ✅ Free credits | [api.together.ai](https://api.together.ai/settings/api-keys) |
| **Mistral** | ✅ Free tier | [console.mistral.ai](https://console.mistral.ai/api-keys/) |
| **Cohere** | ✅ Free tier | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) |
| **OpenAI** | 💳 Paid | [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | 💳 Paid | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Stability AI** | 💳 Paid | [platform.stability.ai](https://platform.stability.ai/account/credits) |

### 3. Get your Discord User ID

Discord Settings → **Advanced** → enable **Developer Mode**, then right-click your name → **Copy User ID**.

### 4. Configure `.env`

```bash
cp .env.example .env
# Fill in at minimum: DISCORD_TOKEN, CLIENT_ID, OWNER_ID
# Plus keys for whichever providers you want to use
```

### 5. Run locally

```bash
npm install
npm start
```

Slash commands are registered globally on startup — they may take up to an hour to appear in all servers, but usually show up within seconds.

---

## ☁️ Deploy to Railway

1. Push to a GitHub repo
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select your repo
3. Go to **Variables** and add your env vars (see `.env.example` for all options)
4. Railway auto-deploys on every push ✅

> **Railway note:** `data/` is ephemeral by default and resets on redeploy. To persist memories, logs, and state across deploys, add a **Railway Volume** mounted at `/app/data`.

---

## 💬 Talking to the Bot

There is no `/chat` command. Conversation works naturally:

| How | Example |
|---|---|
| **@mention** | `@BotName what's up?` |
| **Reply to the bot's message** | Just hit Reply on any of its messages and type |
| **DM the bot** | Send it a direct message |
| **RESPOND_TO_ALL mode** | Set `RESPOND_TO_ALL=true` to respond to every message in channels |

The bot reads the full conversation history per channel, so it remembers what was said earlier in the session.

---

## 🔑 Keyword Triggers

Keyword triggers let you define **pre-set replies** that fire instead of the AI when a specific word or phrase is detected — no API call, instant response.

**Rules:**
- The message must **@mention the bot** (or be a DM/reply) — triggers don't fire on random messages
- Matching is **case-insensitive** and **whole-word** (so `gg` won't match `egg`)
- If a keyword has **multiple replies**, one is chosen **at random**
- Triggers are checked **before** the AI — if one matches, the AI is skipped entirely

**Managing triggers** (owner only):

```
/trigger add keyword:bingo reply:BINGO! 🎉
/trigger add keyword:bingo reply:we have a winner!!
/trigger add keyword:bingo reply:yooo let's gooo 🎊

/trigger add keyword:good morning reply:morning! coffee first ☕
/trigger add keyword:gg reply:gg ez 😤

/trigger list                        → shows all keywords
/trigger list keyword:bingo          → shows all replies for "bingo" with their index
/trigger remove keyword:bingo index:1  → removes reply at index 1
/trigger remove keyword:bingo          → removes the entire "bingo" trigger
```

You can also pre-populate `data/triggers.json` directly (see `triggers.json.example`).

---

## 💬 Commands

All commands use Discord's native `/` slash UI — with autocomplete, typed inputs, and descriptions built in.

### Available to authorized users

| Command | Description |
|---|---|
| `/imagine prompt:<text>` | Generate an image with AI 🎨 |
| `/memory add user:<@user> fact:<text>` | Save a fact about a user 🧠 |
| `/memory list [user:<@user>]` | View memories (yours or someone else's) |
| `/memory remove scope:<id or "global"> index:<n>` | Delete a memory by its index |
| `/logs recent [count:<n>]` | Show recent messages in this channel 📋 |
| `/logs search keyword:<word>` | Search the chat log 🔍 |
| `/logs ask question:<text>` | Ask the AI a question about chat history 🗂️ |
| `/status` | Show active AI provider and model |
| `/persona` | Show current persona name and description |
| `/clear` | Clear in-memory conversation for this channel |

### Owner only

| Command | Description |
|---|---|
| `/trigger add keyword:<word> reply:<text>` | Add a keyword auto-reply |
| `/trigger remove keyword:<word> [index:<n>]` | Remove a reply or entire keyword |
| `/trigger list [keyword:<word>]` | List triggers or replies for a keyword |
| `/auth add user:<@user>` | Authorize a Discord user |
| `/auth remove user:<@user>` | Remove authorization |
| `/auth list` | List all authorized users |
| `/memory add-global fact:<text>` | Add a fact about everyone |
| `/provider set name:<provider> [model:<name>]` | Switch chat provider |
| `/provider list` | List all chat providers |
| `/provider models` | Show free models for current provider |
| `/model name:<model>` | Set chat model directly |
| `/imgprovider set name:<provider> [model:<name>]` | Switch image provider |
| `/imgprovider list` | List all image providers |
| `/reload` | Reload `persona.json` without restarting |

---

## 🤖 Supported Chat Providers

| Provider | Default free model | Env var |
|---|---|---|
| `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `gemini` | `gemini-2.0-flash` | `GEMINI_API_KEY` |
| `mistral` | `mistral-small-latest` | `MISTRAL_API_KEY` |
| `cohere` | `command-r` | `COHERE_API_KEY` |
| `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `anthropic` | `claude-3-5-haiku-latest` | `ANTHROPIC_API_KEY` |
| `ollama` | `llama3` | `OLLAMA_BASE_URL` |

Switch live with `/provider set` — no restart needed. Model state is persisted in `data/state.json`.

## 🎨 Supported Image Providers

| Provider | Default free model | Env var |
|---|---|---|
| `together` | `black-forest-labs/FLUX.1-schnell-Free` | `TOGETHER_API_KEY` |
| `gemini-imagen` | `imagen-3.0-generate-002` | `GEMINI_API_KEY` |
| `openai-dall-e` | `dall-e-3` | `OPENAI_API_KEY` |
| `stability` | `stable-diffusion-xl-1024-v1-0` | `STABILITY_API_KEY` |
| `none` | — | (disables `/imagine`) |

Image generation uses a completely separate provider from chat, so they can be mixed freely.

---

## 🧠 Custom Memories

Memories are injected into the AI's system prompt so they're used naturally in conversation.

```
/memory add user:@Alex fact:prefers to be called "Lex"
/memory add user:@Alex fact:studying computer science, hates group projects
/memory add user:@Sam  fact:birthday is November 12
/memory add-global fact:everyone in this server plays Valorant
/memory add-global fact:the group hates early morning calls
```

- **User memories** — any authorized user can add facts about any user
- **Global memories** — owner only, apply to everyone
- Memories persist in `data/memories.json` across restarts
- Use `/memory list` to see entries with their index, `/memory remove` to delete by index

---

## 😀 Custom App Emojis

1. Go to [Developer Portal](https://discord.com/developers/applications) → your app → **Emojis** tab
2. Upload your emoji images (PNG/GIF)
3. The bot loads them on startup and uses them naturally in responses
4. The bot also randomly reacts to messages using these emojis (frequency controlled by `REACTION_CHANCE`)

---

## 🎭 Custom Persona

Edit `persona.json` and use `/reload` to apply changes without restarting:

```json
{
  "name": "Aria",
  "description": "Aria is a witty, sharp AI companion who's deeply curious and genuinely fun to talk to.",
  "traits": ["witty", "curious", "empathetic", "slightly sarcastic"],
  "tone": "Conversational and warm. Like a smart friend texting you, not a customer service bot.",
  "rules": [
    "Never break character.",
    "Keep replies to 2-4 sentences unless more depth is truly needed.",
    "Never be condescending."
  ],
  "extra_context": "Aria loves coffee metaphors and occasionally references obscure 80s sci-fi.",
  "status": "drifting through the wires",
  "error_messages": {
    "overloaded": "ugh, too many thoughts at once — give me a sec 😵",
    "ratelimit": "okay okay, one thing at a time 🥲",
    "fallback": "something broke on my end, try again 🔄"
  }
}
```

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `CLIENT_ID` | ✅ | Application ID (for slash command registration) |
| `OWNER_ID` | ✅ | Your Discord user ID |
| `GEMINI_API_KEY` | If using Gemini | Google AI Studio key |
| `GROQ_API_KEY` | If using Groq | Groq Cloud key |
| `OPENAI_API_KEY` | If using OpenAI | OpenAI key |
| `ANTHROPIC_API_KEY` | If using Anthropic | Anthropic key |
| `MISTRAL_API_KEY` | If using Mistral | Mistral key |
| `COHERE_API_KEY` | If using Cohere | Cohere key |
| `TOGETHER_API_KEY` | If using Together AI images | Together AI key |
| `STABILITY_API_KEY` | If using Stability AI | Stability key |
| `OLLAMA_BASE_URL` | If using Ollama | Default: `http://localhost:11434` |
| `AI_PROVIDER` | ❌ | Starting chat provider (default: `gemini`) |
| `AI_MODEL` | ❌ | Starting chat model (blank = provider default) |
| `IMAGE_PROVIDER` | ❌ | Starting image provider (default: `gemini-imagen`) |
| `IMAGE_MODEL` | ❌ | Starting image model (blank = provider default) |
| `AUTHORIZED_USERS` | ❌ | Comma-separated user IDs (seeded on startup) |
| `RESPOND_TO_ALL` | ❌ | `true` to respond to all messages (default: `false`) |
| `MAX_HISTORY` | ❌ | Conversation turns to keep in memory (default: `30`) |
| `REACTION_CHANCE` | ❌ | Emoji reaction probability 0–1 (default: `0.3`) |
| `ERROR_MSG_OVERLOADED` | ❌ | Custom message for 503/overloaded errors |
| `ERROR_MSG_RATELIMIT` | ❌ | Custom message for 429/rate limit errors |
| `ERROR_MSG_AUTH` | ❌ | Custom message for 401/403 auth errors |
| `ERROR_MSG_NOTFOUND` | ❌ | Custom message for 404/model not found errors |
| `ERROR_MSG_FALLBACK` | ❌ | Custom message for all other errors |

---

## 📝 License

MIT
