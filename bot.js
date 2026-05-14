'use strict';

const { Client, GatewayIntentBits, Events, ActivityType, AttachmentBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR      = path.join(__dirname, 'data');
const PERSONA_PATH  = path.join(__dirname, 'persona.json');
const AUTH_PATH     = path.join(DATA_DIR, 'authorized.json');
const MEMORIES_PATH = path.join(DATA_DIR, 'memories.json');
const STATE_PATH    = path.join(DATA_DIR, 'state.json');   // active provider/model
const LOG_DIR       = path.join(DATA_DIR, 'logs');

for (const dir of [DATA_DIR, LOG_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

function readJSON(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fallback; }
}
function writeJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf-8'); }

// ─── Persona ──────────────────────────────────────────────────────────────────

let persona = readJSON(PERSONA_PATH, {
  name: 'Bot', description: 'A helpful assistant.',
  traits: [], tone: 'Friendly.', rules: [],
  extra_context: '', status: '',
  error_messages: {},
});

// ─── Provider + model catalog ─────────────────────────────────────────────────
// Each provider has a list of known free-tier models as defaults.
// User can override model freely — these are just convenient presets.
//
// CHAT providers:
//   gemini    → Google Gemini         GEMINI_API_KEY
//   groq      → Groq Cloud            GROQ_API_KEY
//   openai    → OpenAI                OPENAI_API_KEY
//   anthropic → Anthropic Claude      ANTHROPIC_API_KEY
//   mistral   → Mistral AI            MISTRAL_API_KEY
//   cohere    → Cohere                COHERE_API_KEY
//   ollama    → Ollama (local)        OLLAMA_BASE_URL (no key)
//
// IMAGE providers (separate from chat):
//   gemini-imagen → Google Imagen 3   GEMINI_API_KEY
//   together      → Together AI       TOGETHER_API_KEY
//   openai-dall-e → OpenAI DALL-E 3   OPENAI_API_KEY
//   stability     → Stability AI      STABILITY_API_KEY
//   none          → disable image gen

const PROVIDER_DEFAULTS = {
  gemini    : 'gemini-2.0-flash',
  groq      : 'llama-3.3-70b-versatile',
  openai    : 'gpt-4o-mini',
  anthropic : 'claude-3-5-haiku-latest',
  mistral   : 'mistral-small-latest',
  cohere    : 'command-r',
  ollama    : 'llama3',
};

// Free / commonly free models list shown in !model list
const FREE_MODELS = {
  gemini    : ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-lite'],
  groq      : ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'llama3-8b-8192', 'llama3-70b-8192'],
  openai    : ['gpt-4o-mini'],
  anthropic : ['claude-3-5-haiku-latest', 'claude-3-haiku-20240307'],
  mistral   : ['mistral-small-latest', 'open-mistral-7b', 'open-mixtral-8x7b'],
  cohere    : ['command-r', 'command-light'],
  ollama    : ['llama3', 'mistral', 'phi3', 'gemma2'],
};

const IMAGE_PROVIDER_DEFAULTS = {
  'gemini-imagen' : 'imagen-3.0-generate-002',
  'together'      : 'black-forest-labs/FLUX.1-schnell-Free',
  'openai-dall-e' : 'dall-e-3',
  'stability'     : 'stable-diffusion-xl-1024-v1-0',
  'none'          : '',
};

// ─── Active state (persisted so it survives restarts) ─────────────────────────

let state = readJSON(STATE_PATH, {
  chatProvider  : (process.env.AI_PROVIDER       || 'gemini').toLowerCase(),
  chatModel     : process.env.AI_MODEL            || '',   // '' = use provider default
  imageProvider : (process.env.IMAGE_PROVIDER     || 'gemini-imagen').toLowerCase(),
  imageModel    : process.env.IMAGE_MODEL         || '',   // '' = use provider default
});

function saveState() { writeJSON(STATE_PATH, state); }

function activeChatModel() {
  return state.chatModel || PROVIDER_DEFAULTS[state.chatProvider] || 'unknown';
}
function activeImageModel() {
  if (state.imageProvider === 'none') return 'disabled';
  return state.imageModel || IMAGE_PROVIDER_DEFAULTS[state.imageProvider] || 'unknown';
}

// ─── Lazy provider clients ────────────────────────────────────────────────────

let _gemini, _groq, _openai, _anthropic, _mistral, _cohere;

function getGemini() {
  if (!_gemini) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _gemini;
}
function getGroq() {
  if (!_groq) {
    const Groq = require('groq-sdk');
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}
function getOpenAI(baseURL, apiKey) {
  // Can be called for both OpenAI and Ollama (different baseURL)
  if (baseURL) {
    const { OpenAI } = require('openai');
    return new OpenAI({ baseURL, apiKey: apiKey || 'ignored' });
  }
  if (!_openai) {
    const { OpenAI } = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}
function getAnthropic() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}
function getMistral() {
  if (!_mistral) {
    const { Mistral } = require('@mistralai/mistralai');
    _mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
  }
  return _mistral;
}
function getCohere() {
  if (!_cohere) {
    const { CohereClient } = require('cohere-ai');
    _cohere = new CohereClient({ token: process.env.COHERE_API_KEY });
  }
  return _cohere;
}

// ─── Friendly error messages ──────────────────────────────────────────────────

const ERR = {
  overloaded : process.env.ERROR_MSG_OVERLOADED || "i'm a bit overwhelmed right now, try again in a sec 😅",
  ratelimit  : process.env.ERROR_MSG_RATELIMIT  || "slow down a little, i need a breather 🥲",
  auth       : process.env.ERROR_MSG_AUTH       || "something's wrong on my end — ping the owner 🔧",
  notfound   : process.env.ERROR_MSG_NOTFOUND   || "that model doesn't seem to exist, owner should check the config 🤔",
  fallback   : process.env.ERROR_MSG_FALLBACK   || "ran into a hiccup, try again in a moment 🔄",
};

function friendlyError(err) {
  const em  = { ...ERR, ...(persona.error_messages || {}) };
  const msg = (err?.message || '').toLowerCase();
  const s   = err?.status || err?.statusCode || err?.error?.status || 0;

  if (s === 503 || msg.includes('503') || msg.includes('service unavailable') ||
      msg.includes('high demand') || msg.includes('overloaded'))          return em.overloaded;
  if (s === 429 || msg.includes('429') || msg.includes('rate limit') ||
      msg.includes('quota') || msg.includes('too many requests'))         return em.ratelimit;
  if (s === 401 || s === 403 || msg.includes('api key') ||
      msg.includes('unauthorized') || msg.includes('authentication'))     return em.auth;
  if (s === 404 || msg.includes('404') || msg.includes('not found') ||
      msg.includes('no such model') || msg.includes('does not exist'))    return em.notfound;
  return em.fallback;
}

// ─── Authorized users ─────────────────────────────────────────────────────────

function loadAuthorized() {
  const stored = readJSON(AUTH_PATH, { userIds: [] });
  const envIds = (process.env.AUTHORIZED_USERS || '').split(',').map(s => s.trim()).filter(Boolean);
  const merged = [...new Set([...stored.userIds, ...envIds])];
  if (merged.length !== stored.userIds.length) writeJSON(AUTH_PATH, { userIds: merged });
  return merged;
}
function saveAuthorized(ids) { writeJSON(AUTH_PATH, { userIds: [...new Set(ids)] }); }
function isAuthorized(userId) {
  if (process.env.OWNER_ID && userId === process.env.OWNER_ID) return true;
  return loadAuthorized().includes(userId);
}

// ─── Memories ─────────────────────────────────────────────────────────────────

function loadMemories() { return readJSON(MEMORIES_PATH, { global: [] }); }
function saveMemories(m) { writeJSON(MEMORIES_PATH, m); }

function addMemory(scope, text) {
  const m = loadMemories();
  if (!m[scope]) m[scope] = [];
  m[scope].push(text);
  saveMemories(m);
}
function removeMemory(scope, index) {
  const m = loadMemories();
  if (!m[scope] || m[scope][index] === undefined) return false;
  m[scope].splice(index, 1);
  saveMemories(m);
  return true;
}
function buildMemoryBlock(userId, username) {
  const m = loadMemories();
  const lines = [];
  if (m.global?.length) {
    lines.push('== Things true about everyone ==');
    m.global.forEach(e => lines.push(`• ${e}`));
  }
  if (m[userId]?.length) {
    lines.push(`== Things about ${username} ==`);
    m[userId].forEach(e => lines.push(`• ${e}`));
  }
  return lines.join('\n');
}

// ─── Chat log ─────────────────────────────────────────────────────────────────

function appendLog(channelId, entry) {
  fs.appendFileSync(path.join(LOG_DIR, `${channelId}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8');
}
function readLog(channelId, limit = 100) {
  const f = path.join(LOG_DIR, `${channelId}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).slice(-limit).map(l => JSON.parse(l));
}
function searchLog(channelId, query) {
  const f = path.join(LOG_DIR, `${channelId}.jsonl`);
  if (!fs.existsSync(f)) return [];
  const q = query.toLowerCase();
  return fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).filter(e => e.content?.toLowerCase().includes(q));
}

// ─── App emoji cache ──────────────────────────────────────────────────────────

const appEmojiCache = new Map(); // name → "<:name:id>" or "<a:name:id>"

async function loadAppEmojis() {
  try {
    const emojis = await client.application.emojis.fetch();
    appEmojiCache.clear();
    emojis.forEach(e => {
      appEmojiCache.set(e.name, e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`);
    });
    if (appEmojiCache.size)
      console.log(`😀 App emojis loaded: ${[...appEmojiCache.keys()].join(', ')}`);
    else
      console.log('😶 No app emojis found — upload some in Dev Portal → your app → Emojis.');
  } catch (err) {
    console.warn('Could not load app emojis:', err.message);
  }
}

function resolveEmojis(text) {
  return text.replace(/:([a-zA-Z0-9_]+):/g, (match, name) => appEmojiCache.get(name) ?? match);
}

function buildEmojiContext() {
  if (!appEmojiCache.size) return '';
  const list = [...appEmojiCache.keys()].map(n => `:${n}:`).join(', ');
  return `You have access to these custom emojis. Use them by writing their name in colons e.g. :wave:\nAvailable: ${list}\nUse them naturally and sparingly, only when they genuinely fit the mood.`;
}

// React to a message with a random app emoji (best-effort)
const REACTION_CHANCE = parseFloat(process.env.REACTION_CHANCE || '0.3');

async function maybeReact(message) {
  if (!appEmojiCache.size || Math.random() > REACTION_CHANCE) return;
  try {
    const keys  = [...appEmojiCache.keys()];
    const name  = keys[Math.floor(Math.random() * keys.length)];
    const emoji = (await client.application.emojis.fetch()).find(e => e.name === name);
    if (emoji) await message.react(emoji);
  } catch { /* reactions are best-effort */ }
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(userId, username) {
  const memBlock   = buildMemoryBlock(userId, username);
  const emojiBlock = buildEmojiContext();
  return [
    `You are ${persona.name}.`,
    '',
    persona.description,
    '',
    `Personality traits: ${persona.traits.join(', ')}.`,
    '',
    `Tone: ${persona.tone}`,
    '',
    'Rules you must always follow:',
    ...persona.rules.map((r, i) => `${i + 1}. ${r}`),
    '',
    persona.extra_context ? `Additional context:\n${persona.extra_context}` : null,
    '',
    memBlock   ? `Custom memories you know:\n${memBlock}` : null,
    '',
    emojiBlock ? emojiBlock : null,
    '',
    'Stay in character at all times.',
    'Use memories naturally — never say "I remember" or "according to my memories".',
  ].filter(l => l !== null).join('\n').trim();
}

// ─── Conversation history ─────────────────────────────────────────────────────
// OpenAI-format [{role,content}] for all providers except Gemini [{role,parts}]

const conversationHistory = new Map();
const MAX_PAIRS = parseInt(process.env.MAX_HISTORY || '30', 10);

function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
  return conversationHistory.get(channelId);
}
function pushHistory(history, userMsg, assistantMsg, isGemini = false) {
  if (isGemini) {
    history.push({ role: 'user',  parts: [{ text: userMsg }] });
    history.push({ role: 'model', parts: [{ text: assistantMsg }] });
  } else {
    history.push({ role: 'user',      content: userMsg });
    history.push({ role: 'assistant', content: assistantMsg });
  }
  if (history.length > MAX_PAIRS * 2) history.splice(0, 2);
}

// ─── Chat provider implementations ───────────────────────────────────────────

async function chatGemini(channelId, msg, systemPrompt) {
  const model = getGemini().getGenerativeModel({
    model: activeChatModel(),
    systemInstruction: systemPrompt,
  });
  const history = getHistory(channelId);
  const chat    = model.startChat({ history });
  const result  = await chat.sendMessage(msg);
  const reply   = result.response.text();
  pushHistory(history, msg, reply, true);
  return reply;
}

async function chatOpenAICompat(channelId, msg, systemPrompt, oaiClient, model) {
  const history  = getHistory(channelId);
  const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: msg }];
  const res      = await oaiClient.chat.completions.create({ model, messages });
  const reply    = res.choices[0].message.content;
  pushHistory(history, msg, reply);
  return reply;
}

async function chatAnthropic(channelId, msg, systemPrompt) {
  const history  = getHistory(channelId);
  const messages = [...history, { role: 'user', content: msg }];
  const res      = await getAnthropic().messages.create({
    model     : activeChatModel(),
    system    : systemPrompt,
    messages,
    max_tokens: 1024,
  });
  const reply = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  pushHistory(history, msg, reply);
  return reply;
}

async function chatMistral(channelId, msg, systemPrompt) {
  const history  = getHistory(channelId);
  const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: msg }];
  const res      = await getMistral().chat.complete({ model: activeChatModel(), messages });
  const reply    = res.choices[0].message.content;
  pushHistory(history, msg, reply);
  return reply;
}

async function chatCohere(channelId, msg, systemPrompt) {
  const history = getHistory(channelId);
  // Cohere uses chatHistory format
  const chatHistory = history.map(m => ({
    role    : m.role === 'assistant' ? 'CHATBOT' : 'USER',
    message : m.content,
  }));
  const res   = await getCohere().chat({
    model      : activeChatModel(),
    preamble   : systemPrompt,
    chatHistory,
    message    : msg,
  });
  const reply = res.text;
  pushHistory(history, msg, reply);
  return reply;
}

// ─── Unified chat call ────────────────────────────────────────────────────────

async function getAIResponse(channelId, userMessage, userId, username) {
  const systemPrompt = buildSystemPrompt(userId, username);
  const msg          = `[${username}]: ${userMessage}`;
  let   reply;

  switch (state.chatProvider) {
    case 'groq':
      reply = await chatOpenAICompat(channelId, msg, systemPrompt, getGroq(), activeChatModel());
      break;
    case 'openai':
      reply = await chatOpenAICompat(channelId, msg, systemPrompt, getOpenAI(), activeChatModel());
      break;
    case 'ollama':
      reply = await chatOpenAICompat(
        channelId, msg, systemPrompt,
        getOpenAI((process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/v1', 'ollama'),
        activeChatModel()
      );
      break;
    case 'anthropic':
      reply = await chatAnthropic(channelId, msg, systemPrompt);
      break;
    case 'mistral':
      reply = await chatMistral(channelId, msg, systemPrompt);
      break;
    case 'cohere':
      reply = await chatCohere(channelId, msg, systemPrompt);
      break;
    case 'gemini':
    default:
      reply = await chatGemini(channelId, msg, systemPrompt);
      break;
  }

  const ts = new Date().toISOString();
  appendLog(channelId, { ts, userId, username, role: 'user',  content: userMessage });
  appendLog(channelId, { ts, userId: 'bot', username: persona.name, role: 'model', content: reply });

  return reply;
}

// ─── Log Q&A (one-shot, uses active chat provider) ───────────────────────────

async function queryLog(channelId, question) {
  const entries = readLog(channelId, 200);
  if (!entries.length) return 'No chat history found for this channel.';
  const logText  = entries.map(e => `[${e.ts.slice(0, 16)}] ${e.username}: ${e.content}`).join('\n');
  const system   = 'You answer questions about a Discord chat log. Answer only from what is in the log. Be concise. If the answer is not there, say so.';
  const userMsg  = `Chat log:\n\n${logText}\n\nQuestion: ${question}`;

  switch (state.chatProvider) {
    case 'groq':
      return (await getGroq().chat.completions.create({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    case 'openai':
      return (await getOpenAI().chat.completions.create({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    case 'anthropic':
      return (await getAnthropic().messages.create({ model: activeChatModel(), system, messages: [{ role: 'user', content: userMsg }], max_tokens: 1024 })).content.filter(b => b.type === 'text').map(b => b.text).join('');
    case 'mistral':
      return (await getMistral().chat.complete({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    case 'cohere':
      return (await getCohere().chat({ model: activeChatModel(), preamble: system, message: userMsg })).text;
    case 'ollama': {
      const oc = getOpenAI((process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/v1', 'ollama');
      return (await oc.chat.completions.create({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    }
    case 'gemini':
    default: {
      const m = getGemini().getGenerativeModel({ model: activeChatModel(), systemInstruction: system });
      return (await m.generateContent(userMsg)).response.text();
    }
  }
}

// ─── Image generation (separate provider) ────────────────────────────────────

async function generateImage(prompt) {
  switch (state.imageProvider) {
    case 'none':
      throw new Error('Image generation is disabled. Owner can enable it with !imgprovider set <provider>.');

    case 'gemini-imagen': {
      const model  = activeImageModel();
      const m      = getGemini().getGenerativeModel({ model });
      const r      = await m.generateImages({ prompt, numberOfImages: 1, outputOptions: { mimeType: 'image/png' } });
      if (!r.images?.length) throw new Error('No image returned from Imagen.');
      return { buffer: Buffer.from(r.images[0].imageBytes, 'base64'), ext: 'png' };
    }

    case 'together': {
      // Together AI image generation via REST (no official SDK needed)
      const model = activeImageModel();
      const res   = await fetch('https://api.together.xyz/v1/images/generations', {
        method  : 'POST',
        headers : { 'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`, 'Content-Type': 'application/json' },
        body    : JSON.stringify({ model, prompt, n: 1, width: 1024, height: 1024 }),
      });
      if (!res.ok) throw new Error(`Together API error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const url  = data.data?.[0]?.url;
      if (!url) throw new Error('No image URL returned from Together AI.');
      const imgRes = await fetch(url);
      return { buffer: Buffer.from(await imgRes.arrayBuffer()), ext: 'png' };
    }

    case 'openai-dall-e': {
      const res  = await getOpenAI().images.generate({ model: activeImageModel(), prompt, n: 1, size: '1024x1024', response_format: 'b64_json' });
      const b64  = res.data?.[0]?.b64_json;
      if (!b64) throw new Error('No image data returned from DALL-E.');
      return { buffer: Buffer.from(b64, 'base64'), ext: 'png' };
    }

    case 'stability': {
      const model  = activeImageModel();
      const form   = new URLSearchParams();
      form.append('text_prompts[0][text]', prompt);
      form.append('cfg_scale', '7');
      form.append('height', '1024');
      form.append('width', '1024');
      form.append('samples', '1');
      const res    = await fetch(`https://api.stability.ai/v1/generation/${model}/text-to-image`, {
        method  : 'POST',
        headers : { Authorization: `Bearer ${process.env.STABILITY_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body    : form.toString(),
      });
      if (!res.ok) throw new Error(`Stability API error: ${res.status} ${await res.text()}`);
      const data   = await res.json();
      const b64    = data.artifacts?.[0]?.base64;
      if (!b64) throw new Error('No image data returned from Stability AI.');
      return { buffer: Buffer.from(b64, 'base64'), ext: 'png' };
    }

    default:
      throw new Error(`Unknown image provider: ${state.imageProvider}`);
  }
}

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

async function sendLong(message, text) {
  const chunks = text.match(/[\s\S]{1,1990}/g) || ['(empty)'];
  let first = true;
  for (const chunk of chunks) {
    if (first) { await message.reply(chunk); first = false; }
    else { await message.channel.send(chunk); }
  }
}

const PREFIX = process.env.PREFIX || '!';

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async c => {
  console.log(`✅ ${c.user.tag} online`);
  console.log(`🎭 Persona: ${persona.name}`);
  console.log(`🤖 Chat: ${state.chatProvider} / ${activeChatModel()}`);
  console.log(`🎨 Image: ${state.imageProvider} / ${activeImageModel()}`);
  console.log(`🔐 Authorized: ${loadAuthorized().join(', ') || '(none)'}`);
  await loadAppEmojis();
  c.user.setPresence({
    activities: [{ name: persona.status || `as ${persona.name}`, type: ActivityType.Playing }],
    status: 'online',
  });
});

// ─── Main message handler ─────────────────────────────────────────────────────

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const content    = message.content.trim();
  const userId     = message.author.id;
  const username   = message.author.username;
  const hasPrefix  = content.startsWith(PREFIX);
  const botMention = message.mentions.has(client.user);
  const isDM       = message.channel.type === 1;
  const isOwner    = !!process.env.OWNER_ID && userId === process.env.OWNER_ID;

  let cmd = '', rawArgs = '';
  if (hasPrefix) {
    const after = content.slice(PREFIX.length).trim();
    const space = after.search(/\s/);
    cmd     = (space === -1 ? after : after.slice(0, space)).toLowerCase();
    rawArgs = space === -1 ? '' : after.slice(space + 1).trim();
  }

  // ════════════════════════════════════════════════════════════════════
  // OWNER-ONLY COMMANDS
  // ════════════════════════════════════════════════════════════════════

  if (isOwner && hasPrefix) {

    // !reload
    if (cmd === 'reload') {
      try {
        persona = JSON.parse(fs.readFileSync(PERSONA_PATH, 'utf-8'));
        conversationHistory.clear();
        await message.reply(`♻️ Persona reloaded as **${persona.name}**. Conversation memory cleared.`);
      } catch (e) { await message.reply(`❌ ${e.message}`); }
      return;
    }

    // !auth add|remove|list [id]
    if (cmd === 'auth') {
      const parts    = rawArgs.split(/\s+/);
      const sub      = parts[0]?.toLowerCase();
      const targetId = parts[1]?.replace(/[<@!>]/g, '');

      if (sub === 'list') {
        const ids = loadAuthorized();
        await message.reply(ids.length
          ? `**🔐 Authorized users:**\n${ids.map(id => `• <@${id}>  \`${id}\``).join('\n')}`
          : '**🔐 Authorized users:** *none yet.*'
        );
        return;
      }
      if (sub === 'add' && targetId) {
        const ids = loadAuthorized();
        if (ids.includes(targetId)) { await message.reply(`ℹ️ \`${targetId}\` already authorized.`); return; }
        saveAuthorized([...ids, targetId]);
        await message.reply(`✅ <@${targetId}> authorized.`);
        return;
      }
      if (sub === 'remove' && targetId) {
        saveAuthorized(loadAuthorized().filter(id => id !== targetId));
        await message.reply(`🗑️ \`${targetId}\` removed.`);
        return;
      }
      await message.reply(`\`${PREFIX}auth add/remove/list <id or @mention>\``);
      return;
    }

    // !model set <model> | list | current
    if (cmd === 'model') {
      const parts = rawArgs.split(/\s+/);
      const sub   = parts[0]?.toLowerCase();

      if (sub === 'set' && parts[1]) {
        state.chatModel = parts[1];
        saveState();
        conversationHistory.clear();
        await message.reply(`✅ Chat model set to \`${state.chatModel}\`. History cleared.`);
        return;
      }
      if (sub === 'list') {
        const models = FREE_MODELS[state.chatProvider];
        if (!models) { await message.reply(`No preset models listed for **${state.chatProvider}**.`); return; }
        await message.reply(
          `**Free/default models for ${state.chatProvider}:**\n` +
          models.map((m, i) => `${i === 0 ? '⭐' : '•'} \`${m}\``).join('\n') +
          `\n\nCurrent: \`${activeChatModel()}\`\nSwitch with \`${PREFIX}model set <name>\``
        );
        return;
      }
      if (sub === 'current' || sub === 'status') {
        await message.reply(`🤖 **Chat:** \`${state.chatProvider}\` / \`${activeChatModel()}\`\n🎨 **Image:** \`${state.imageProvider}\` / \`${activeImageModel()}\``);
        return;
      }
      await message.reply(
        `**!model commands:**\n` +
        `\`${PREFIX}model list\` — show free models for current provider\n` +
        `\`${PREFIX}model set <name>\` — switch to a different model\n` +
        `\`${PREFIX}model current\` — show active model`
      );
      return;
    }

    // !provider set <provider> [model] | list | current
    if (cmd === 'provider') {
      const parts = rawArgs.split(/\s+/);
      const sub   = parts[0]?.toLowerCase();

      if (sub === 'set' && parts[1]) {
        const newProvider = parts[1].toLowerCase();
        if (!PROVIDER_DEFAULTS[newProvider]) {
          await message.reply(`❌ Unknown provider \`${newProvider}\`. Available: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`);
          return;
        }
        state.chatProvider = newProvider;
        state.chatModel    = parts[2] || '';  // optional model override
        conversationHistory.clear();
        saveState();
        await message.reply(`✅ Chat provider → **${state.chatProvider}** / model → \`${activeChatModel()}\`. History cleared.`);
        return;
      }
      if (sub === 'list') {
        const list = Object.entries(PROVIDER_DEFAULTS)
          .map(([p, m]) => `${p === state.chatProvider ? '✅' : '•'} **${p}** (default: \`${m}\`)`)
          .join('\n');
        await message.reply(`**Chat providers:**\n${list}`);
        return;
      }
      if (sub === 'current') {
        await message.reply(`🤖 Provider: **${state.chatProvider}** | Model: \`${activeChatModel()}\``);
        return;
      }
      await message.reply(
        `**!provider commands:**\n` +
        `\`${PREFIX}provider list\` — list all providers\n` +
        `\`${PREFIX}provider set <name> [model]\` — switch provider (optionally specify model)\n` +
        `\`${PREFIX}provider current\` — show active provider`
      );
      return;
    }

    // !imgprovider set <provider> [model] | list | current
    if (cmd === 'imgprovider') {
      const parts = rawArgs.split(/\s+/);
      const sub   = parts[0]?.toLowerCase();

      if (sub === 'set' && parts[1]) {
        const newProv = parts[1].toLowerCase();
        if (!(newProv in IMAGE_PROVIDER_DEFAULTS)) {
          await message.reply(`❌ Unknown image provider \`${newProv}\`. Available: ${Object.keys(IMAGE_PROVIDER_DEFAULTS).join(', ')}`);
          return;
        }
        state.imageProvider = newProv;
        state.imageModel    = parts[2] || '';
        saveState();
        await message.reply(`✅ Image provider → **${state.imageProvider}** / model → \`${activeImageModel()}\`.`);
        return;
      }
      if (sub === 'list') {
        const list = Object.entries(IMAGE_PROVIDER_DEFAULTS)
          .map(([p, m]) => `${p === state.imageProvider ? '✅' : '•'} **${p}** (default: \`${m || 'n/a'}\`)`)
          .join('\n');
        await message.reply(`**Image providers:**\n${list}`);
        return;
      }
      if (sub === 'current') {
        await message.reply(`🎨 Image provider: **${state.imageProvider}** | Model: \`${activeImageModel()}\``);
        return;
      }
      await message.reply(
        `**!imgprovider commands:**\n` +
        `\`${PREFIX}imgprovider list\` — list image providers\n` +
        `\`${PREFIX}imgprovider set <name> [model]\` — switch image provider\n` +
        `\`${PREFIX}imgprovider current\` — show active image provider`
      );
      return;
    }

    // Owner memory (global + any user)
    if (cmd === 'memory') {
      const parts = rawArgs.split(/\s+/);
      const sub   = parts[0]?.toLowerCase();
      const scope = parts[1];
      const rest  = parts.slice(2).join(' ');

      if (sub === 'add' && scope && rest) {
        addMemory(scope, rest);
        const label = scope === 'global' ? '🌐 everyone' : `<@${scope}>`;
        await message.reply(`🧠 Memory saved for **${label}**: "${rest}"`);
        return;
      }
      if (sub === 'remove' && scope) {
        const idx = parseInt(parts[2], 10);
        if (isNaN(idx)) { await message.reply(`Provide an index. Use \`${PREFIX}memory list ${scope}\`.`); return; }
        await message.reply(removeMemory(scope, idx)
          ? `🗑️ Memory #${idx} removed from **${scope}**.`
          : `❌ Memory #${idx} not found in **${scope}**.`
        );
        return;
      }
      if (sub === 'list') {
        const m = loadMemories();
        if (scope) {
          const entries = m[scope] || [];
          if (!entries.length) { await message.reply(`No memories for **${scope}**.`); return; }
          await sendLong(message,
            `**Memories for ${scope === 'global' ? '🌐 everyone' : `<@${scope}>`}:**\n` +
            entries.map((e, i) => `\`[${i}]\` ${e}`).join('\n')
          );
        } else {
          const scopes = Object.keys(m);
          if (!scopes.length) { await message.reply('No memories stored.'); return; }
          await message.reply(`**Memory scopes:**\n${scopes.map(s => `**${s === 'global' ? '🌐 global' : `👤 ${s}`}** — ${m[s].length} entr${m[s].length === 1 ? 'y' : 'ies'}`).join('\n')}`);
        }
        return;
      }
      await message.reply(
        `**!memory (owner):**\n` +
        `\`${PREFIX}memory add global <fact>\`\n` +
        `\`${PREFIX}memory add <userId> <fact>\`\n` +
        `\`${PREFIX}memory remove <scope> <index>\`\n` +
        `\`${PREFIX}memory list [scope]\``
      );
      return;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // AUTH GATE
  // ════════════════════════════════════════════════════════════════════

  const wantsResponse = botMention || isDM || hasPrefix || process.env.RESPOND_TO_ALL === 'true';
  if (!wantsResponse) return;
  if (!isAuthorized(userId)) return;

  // ════════════════════════════════════════════════════════════════════
  // AUTHORIZED USER COMMANDS
  // ════════════════════════════════════════════════════════════════════

  if (hasPrefix) {

    // !memory (user-scoped only)
    if (cmd === 'memory') {
      const parts    = rawArgs.split(/\s+/);
      const sub      = parts[0]?.toLowerCase();
      const rawScope = parts[1]?.replace(/[<@!>]/g, '');
      const rest     = parts.slice(2).join(' ');

      if (rawScope === 'global' && !isOwner) {
        await message.reply('🚫 Only the owner can edit global memories.');
        return;
      }
      if (sub === 'add' && rawScope && rest) {
        addMemory(rawScope, rest);
        await message.reply(`🧠 Memory saved for <@${rawScope}>: "${rest}"`);
        return;
      }
      if (sub === 'remove' && rawScope) {
        const idx = parseInt(parts[2], 10);
        if (isNaN(idx)) { await message.reply(`Provide an index. Use \`${PREFIX}memory list ${rawScope}\`.`); return; }
        await message.reply(removeMemory(rawScope, idx)
          ? `🗑️ Memory #${idx} removed for <@${rawScope}>.`
          : `❌ Not found.`
        );
        return;
      }
      if (sub === 'list') {
        const m      = loadMemories();
        const target = rawScope || userId;
        const entries = m[target] || [];
        if (!entries.length) { await message.reply(`No memories for ${rawScope ? `<@${rawScope}>` : 'you'}.`); return; }
        await sendLong(message,
          `**Memories for ${rawScope ? `<@${rawScope}>` : 'you'}:**\n` +
          entries.map((e, i) => `\`[${i}]\` ${e}`).join('\n')
        );
        return;
      }
      await message.reply(
        `**!memory:**\n` +
        `\`${PREFIX}memory add <@user or userId> <fact>\`\n` +
        `\`${PREFIX}memory remove <userId> <index>\`\n` +
        `\`${PREFIX}memory list [userId]\``
      );
      return;
    }

    // !imagine <prompt>
    if (cmd === 'imagine') {
      if (!rawArgs) { await message.reply(`💡 Usage: \`${PREFIX}imagine <describe the image>\``); return; }
      await message.channel.sendTyping();
      try {
        const { buffer, ext } = await generateImage(rawArgs);
        const att = new AttachmentBuilder(buffer, { name: `image.${ext}` });
        await message.reply({ content: `🎨 *${rawArgs}*`, files: [att] });
      } catch (err) {
        console.error('Image gen error:', err);
        await message.reply(`❌ ${friendlyError(err)}`);
      }
      return;
    }

    // !logs [last <n>] | search <keyword>
    if (cmd === 'logs') {
      const parts = rawArgs.split(/\s+/);
      const sub   = parts[0]?.toLowerCase();
      if (sub === 'search') {
        const q = parts.slice(1).join(' ');
        if (!q) { await message.reply(`Usage: \`${PREFIX}logs search <keyword>\``); return; }
        const results = searchLog(message.channelId, q).slice(-20);
        if (!results.length) { await message.reply(`🔍 Nothing found for "${q}".`); return; }
        await sendLong(message, `🔍 **Results for "${q}":**\n` + results.map(e => `[\`${e.ts.slice(0,16)}\`] **${e.username}**: ${e.content.slice(0,120)}`).join('\n'));
        return;
      }
      const n = sub === 'last' ? (parseInt(parts[1], 10) || 20) : 20;
      const entries = readLog(message.channelId, n);
      if (!entries.length) { await message.reply('📋 No log history yet.'); return; }
      await sendLong(message, `📋 **Last ${entries.length} messages:**\n` + entries.map(e => `[\`${e.ts.slice(0,16)}\`] **${e.username}**: ${e.content.slice(0,120)}`).join('\n'));
      return;
    }

    // !ask <question about logs>
    if (cmd === 'ask') {
      if (!rawArgs) { await message.reply(`Usage: \`${PREFIX}ask <question about this channel's history>\``); return; }
      await message.channel.sendTyping();
      try {
        await sendLong(message, `🗂️ ${await queryLog(message.channelId, rawArgs)}`);
      } catch (err) {
        await message.reply(`❌ ${friendlyError(err)}`);
      }
      return;
    }

    // !clear
    if (cmd === 'clear') {
      conversationHistory.delete(message.channelId);
      await message.reply('🧹 Conversation memory cleared. (Logs preserved.)');
      return;
    }

    // !status — show current AI config
    if (cmd === 'status') {
      await message.reply(
        `🤖 **Chat:** \`${state.chatProvider}\` / \`${activeChatModel()}\`\n` +
        `🎨 **Image:** \`${state.imageProvider}\` / \`${activeImageModel()}\``
      );
      return;
    }

    // !persona
    if (cmd === 'persona') {
      const desc = persona.description.slice(0, 300);
      await message.reply(`**🎭 ${persona.name}**\n> ${desc}${persona.description.length > 300 ? '…' : ''}`);
      return;
    }

    // !help
    if (cmd === 'help') {
      const p = PREFIX;
      const ownerSection = isOwner
        ? `\n**🔧 Owner only**\n` +
          `\`${p}provider set/list/current\` — switch chat provider\n` +
          `\`${p}model set/list/current\` — switch chat model\n` +
          `\`${p}imgprovider set/list/current\` — switch image provider\n` +
          `\`${p}auth add/remove/list\` — manage authorized users\n` +
          `\`${p}memory add global <fact>\` — global memory\n` +
          `\`${p}memory add <userId> <fact>\` — user memory\n` +
          `\`${p}memory remove/list\` — manage memories\n` +
          `\`${p}reload\` — reload persona.json`
        : '';
      await message.reply(
        `**📖 Commands**\n` +
        `\`${p}imagine <prompt>\` — Generate an image 🎨\n` +
        `\`${p}memory add <@user> <fact>\` — Save a user fact 🧠\n` +
        `\`${p}memory remove/list\` — Manage your memories\n` +
        `\`${p}logs [last <n>]\` — Recent messages 📋\n` +
        `\`${p}logs search <keyword>\` — Search chat log 🔍\n` +
        `\`${p}ask <question>\` — Ask AI about chat history 🗂️\n` +
        `\`${p}status\` — Show active AI provider/model\n` +
        `\`${p}clear\` — Clear conversation memory\n` +
        `\`${p}persona\` — Show persona info\n` +
        `\`${p}help\` — This message` +
        ownerSection
      );
      return;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // CHAT → AI
  // ════════════════════════════════════════════════════════════════════

  let userMessage = content.replace(`<@${client.user.id}>`, '').trim();
  if (userMessage.startsWith(PREFIX)) userMessage = userMessage.slice(PREFIX.length).trim();
  if (!userMessage) return;

  await message.channel.sendTyping();
  try {
    const reply = await getAIResponse(message.channelId, userMessage, userId, username);
    await sendLong(message, resolveEmojis(reply));
    await maybeReact(message);
  } catch (err) {
    console.error('AI error:', err);
    await message.reply(friendlyError(err));
  }
});

client.login(process.env.DISCORD_TOKEN);
