# Discord Persona Bot

A Discord bot powered by your choice of AI (Google Gemini, Groq, OpenAI, Anthropic, Mistral, Cohere, or Ollama). It features a fully customizable persona, slash commands, authorized-user access control, persistent chat logs, per-user custom memories, and AI image generation from a separate configurable provider.

---

## Features

- **Custom Persona**: Fully editable through `persona.json` — no code changes required
- **Slash Commands**: Modern Discord slash command interface with autocomplete and typed options
- **Authorized Users Only**: The bot ignores messages from non-whitelisted users
- **Multiple AI Providers**: Support for 7 chat providers (Gemini, Groq, OpenAI, Anthropic, Mistral, Cohere, Ollama)
- **Separate Image Generation**: 4 image providers (Gemini Imagen, Together AI, DALL·E 3, Stability AI) that can be configured independently from chat
- **Live Switching**: Change provider or model during runtime using slash commands
- **Persistent Memories**: Per-user and global facts that are injected into every conversation
- **Persistent Chat Logs**: All conversations are saved to disk, searchable, and queryable by AI
- **Natural Interaction**: Supports @mentions, replies, and direct messages
- **Railway Ready**: Easy one-click deployment

---

## Project Structure

```
discord-persona-bot/
├── bot.js                 # Main bot file
├── persona.json           # Persona configuration (edit this)
├── package.json
├── railway.toml
├── .env.example
└── data/                  # Auto-created at runtime
    ├── authorized.json    # Authorized user IDs
    ├── memories.json      # Custom memories
    ├── state.json         # Active provider/model
    └── logs/
        └── <channelId>.jsonl  # Per-channel chat logs
```

---

## Setup

### 1. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**
2. Go to the **Bot** tab → **Add Bot** → Copy the **Token** (this is your `DISCORD_TOKEN`)
3. Go to **General Information** → Copy the **Application ID** (this is your `CLIENT_ID`)
4. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `View Channels`, `Attach Files`, `Add Reactions`
6. Use the generated URL to invite the bot to your server

> **Note**: The `applications.commands` scope is required for slash commands. If the bot was invited without it, re-invite using the updated URL.

### 2. Get API Keys

| Provider       | Free Tier          | Key Location |
|----------------|--------------------|--------------|
| Groq           | Fully free         | [console.groq.com/keys](https://console.groq.com/keys) |
| Gemini         | Free tier          | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Together AI    | Free credits       | [api.together.ai](https://api.together.ai/settings/api-keys) |
| Mistral        | Free tier          | [console.mistral.ai](https://console.mistral.ai/api-keys/) |
| Cohere         | Free tier          | [dashboard.cohere.com](https://dashboard.cohere.com/api-keys) |
| OpenAI         | Paid               | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic      | Paid               | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Stability AI   | Paid               | [platform.stability.ai](https://platform.stability.ai/account/credits) |

### 3. Get Your Discord User ID

Enable **Developer Mode** in Discord Settings → Advanced, then right-click your username and select **Copy User ID**.

### 4. Configure Environment Variables

```bash
cp .env.example .env
```

Fill in at minimum: `DISCORD_TOKEN`, `CLIENT_ID`, and `OWNER_ID`. Add API keys for the providers you want to use.

### 5. Run Locally

```bash
npm install
npm start
```

Slash commands are registered globally on startup. They usually appear within seconds but can take up to an hour in some cases.

---

## Deployment to Railway

1. Push your code to a GitHub repository
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add your environment variables in the dashboard
4. Railway will auto-deploy on every push

> **Note**: The `data/` folder is ephemeral by default. To persist memories, logs, and state across deployments, add a Railway Volume mounted at `/app/data`.

---

## How to Use the Bot

There is no `/chat` command. The bot responds naturally when:

- You **@mention** it
- You **reply** to one of its messages
- You send it a **direct message**
- `RESPOND_TO_ALL=true` is enabled (responds to every message in the channel)

The bot maintains full conversation history per channel.

---

## Commands

All commands use Discord's native slash command interface.

### Available to Authorized Users

| Command | Description |
|---------|-------------|
| `/imagine prompt:<text>` | Generate an image |
| `/memory add user:<@user> fact:<text>` | Add a memory about a user |
| `/memory list [user:<@user>]` | View memories |
| `/memory remove scope:<id or "global"> index:<n>` | Remove a specific memory |
| `/logs recent [count:<n>]` | Show recent messages |
| `/logs search keyword:<word>` | Search chat logs |
| `/logs ask question:<text>` | Ask AI about chat history |
| `/status` | Show current provider and model |
| `/persona` | Show current persona |
| `/clear` | Clear conversation history for the channel |

### Owner Only

| Command | Description |
|---------|-------------|
| `/trigger add ...` | Manage keyword auto-replies |
| `/auth add/remove/list` | Manage authorized users |
| `/memory add-global ...` | Add global memories |
| `/provider set ...` | Switch chat provider/model |
| `/imgprovider set ...` | Switch image provider |
| `/reload` | Reload `persona.json` without restart |

---

## Custom Persona

Edit `persona.json` and use `/reload` to apply changes instantly. Example structure:

```json
{
  "name": "Aria",
  "description": "Aria is a witty, sharp AI companion who's deeply curious and fun to talk to.",
  "traits": ["witty", "curious", "empathetic"],
  "tone": "Conversational and warm. Like a smart friend texting you.",
  "rules": [
    "Never break character.",
    "Keep replies concise unless more detail is needed.",
    "Never be condescending."
  ]
}
```

---

## Environment Variables

See `.env.example` for the full list. Key required variables:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `OWNER_ID`

---

## License

MIT
