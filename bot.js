'use strict';

const {
  Client, GatewayIntentBits, Events, ActivityType,
  AttachmentBuilder, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR      = path.join(__dirname, 'data');
const PERSONA_PATH  = path.join(__dirname, 'persona.json');
const AUTH_PATH     = path.join(DATA_DIR, 'authorized.json');
const MEMORIES_PATH = path.join(DATA_DIR, 'memories.json');
const STATE_PATH    = path.join(DATA_DIR, 'state.json');
const TRIGGERS_PATH = path.join(DATA_DIR, 'triggers.json');
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
  extra_context: '', status: '', error_messages: {},
});

// ─── Provider catalog ─────────────────────────────────────────────────────────

const PROVIDER_DEFAULTS = {
  gemini    : 'gemini-2.0-flash',
  groq      : 'llama-3.3-70b-versatile',
  openai    : 'gpt-4o-mini',
  anthropic : 'claude-3-5-haiku-latest',
  mistral   : 'mistral-small-latest',
  cohere    : 'command-r',
  ollama    : 'llama3',
};

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

// ─── Active state ─────────────────────────────────────────────────────────────

let state = readJSON(STATE_PATH, {
  chatProvider  : (process.env.AI_PROVIDER    || 'gemini').toLowerCase(),
  chatModel     : process.env.AI_MODEL        || '',
  imageProvider : (process.env.IMAGE_PROVIDER || 'gemini-imagen').toLowerCase(),
  imageModel    : process.env.IMAGE_MODEL     || '',
});

function saveState() { writeJSON(STATE_PATH, state); }
function activeChatModel()  { return state.chatModel  || PROVIDER_DEFAULTS[state.chatProvider]  || 'unknown'; }
function activeImageModel() {
  if (state.imageProvider === 'none') return 'disabled';
  return state.imageModel || IMAGE_PROVIDER_DEFAULTS[state.imageProvider] || 'unknown';
}

// ─── Lazy provider clients ────────────────────────────────────────────────────

let _gemini, _groq, _openai, _anthropic, _mistral, _cohere;

function getGemini() {
  if (!_gemini) { const { GoogleGenerativeAI } = require('@google/generative-ai'); _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); }
  return _gemini;
}
function getGroq() {
  if (!_groq) { const Groq = require('groq-sdk'); _groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); }
  return _groq;
}
function getOpenAI(baseURL, apiKey) {
  if (baseURL) { const { OpenAI } = require('openai'); return new OpenAI({ baseURL, apiKey: apiKey || 'ignored' }); }
  if (!_openai) { const { OpenAI } = require('openai'); _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
  return _openai;
}
function getAnthropic() {
  if (!_anthropic) { const Anthropic = require('@anthropic-ai/sdk'); _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }
  return _anthropic;
}
function getMistral() {
  if (!_mistral) { const { Mistral } = require('@mistralai/mistralai'); _mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY }); }
  return _mistral;
}
function getCohere() {
  if (!_cohere) { const { CohereClient } = require('cohere-ai'); _cohere = new CohereClient({ token: process.env.COHERE_API_KEY }); }
  return _cohere;
}

// ─── Friendly errors ──────────────────────────────────────────────────────────

const ERR_DEFAULTS = {
  overloaded : "i'm a bit overwhelmed right now, try again in a sec 😅",
  ratelimit  : "slow down a little, i need a breather 🥲",
  auth       : "something's wrong on my end — ping the owner 🔧",
  notfound   : "that model doesn't exist, owner should check the config 🤔",
  fallback   : "ran into a hiccup, try again in a moment 🔄",
};

function friendlyError(err) {
  const em  = { ...ERR_DEFAULTS, ...(persona.error_messages || {}) };
  const msg = (err?.message || '').toLowerCase();
  const s   = err?.status || err?.statusCode || err?.error?.status || 0;
  if (s === 503 || msg.includes('503') || msg.includes('service unavailable') || msg.includes('high demand') || msg.includes('overloaded')) return em.overloaded;
  if (s === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('too many requests'))         return em.ratelimit;
  if (s === 401 || s === 403 || msg.includes('api key') || msg.includes('unauthorized') || msg.includes('authentication'))                 return em.auth;
  if (s === 404 || msg.includes('404') || msg.includes('not found') || msg.includes('no such model') || msg.includes('does not exist'))    return em.notfound;
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
function isOwner(userId) { return !!process.env.OWNER_ID && userId === process.env.OWNER_ID; }

// ─── Memories ─────────────────────────────────────────────────────────────────

function loadMemories() { return readJSON(MEMORIES_PATH, { global: [] }); }
function saveMemories(m) { writeJSON(MEMORIES_PATH, m); }
function addMemory(scope, text) {
  const m = loadMemories(); if (!m[scope]) m[scope] = []; m[scope].push(text); saveMemories(m);
}
function removeMemory(scope, index) {
  const m = loadMemories();
  if (!m[scope] || m[scope][index] === undefined) return false;
  m[scope].splice(index, 1); saveMemories(m); return true;
}
function buildMemoryBlock(userId, username) {
  const m = loadMemories(); const lines = [];
  if (m.global?.length)   { lines.push('== Things true about everyone =='); m.global.forEach(e => lines.push(`• ${e}`)); }
  if (m[userId]?.length)  { lines.push(`== Things about ${username} ==`);   m[userId].forEach(e => lines.push(`• ${e}`)); }
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
  return fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.content?.toLowerCase().includes(q));
}

// ─── Keyword triggers ─────────────────────────────────────────────────────────
// Persisted in data/triggers.json
// Structure: { "keyword": ["reply 1", "reply 2", ...], ... }
// Matching: message must @mention the bot AND contain the keyword (case-insensitive).
// When multiple replies exist for a keyword, one is chosen at random.

function loadTriggers() { return readJSON(TRIGGERS_PATH, {}); }
function saveTriggers(t) { writeJSON(TRIGGERS_PATH, t); }

function addTrigger(keyword, reply) {
  const t = loadTriggers();
  const k = keyword.toLowerCase().trim();
  if (!t[k]) t[k] = [];
  t[k].push(reply);
  saveTriggers(t);
}

function removeTrigger(keyword, index) {
  const t = loadTriggers();
  const k = keyword.toLowerCase().trim();
  if (!t[k]) return 'no_keyword';
  if (index === undefined || index === null) {
    delete t[k]; saveTriggers(t); return 'deleted_keyword';
  }
  if (t[k][index] === undefined) return 'no_index';
  t[k].splice(index, 1);
  if (t[k].length === 0) delete t[k]; // clean up empty keys
  saveTriggers(t);
  return 'deleted_reply';
}

// Returns the matched reply string or null. Picks randomly from the reply list.
function matchTrigger(text) {
  const t       = loadTriggers();
  const lowered = text.toLowerCase();
  for (const [keyword, replies] of Object.entries(t)) {
    // Match whole word / phrase — surrounded by word boundary or start/end
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re      = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
    if (re.test(lowered) && replies.length) {
      return replies[Math.floor(Math.random() * replies.length)];
    }
  }
  return null;
}

// ─── App emojis ───────────────────────────────────────────────────────────────

const appEmojiCache = new Map();

async function loadAppEmojis() {
  try {
    const emojis = await client.application.emojis.fetch();
    appEmojiCache.clear();
    emojis.forEach(e => appEmojiCache.set(e.name, e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`));
    if (appEmojiCache.size) console.log(`😀 App emojis: ${[...appEmojiCache.keys()].join(', ')}`);
    else console.log('😶 No app emojis found — upload some in Dev Portal → your app → Emojis tab.');
  } catch (err) { console.warn('Could not load app emojis:', err.message); }
}

function resolveEmojis(text) {
  return text.replace(/:([a-zA-Z0-9_]+):/g, (match, name) => appEmojiCache.get(name) ?? match);
}
function buildEmojiContext() {
  if (!appEmojiCache.size) return '';
  return `You have access to these custom emojis — write their name in colons to use them, e.g. :wave:\nAvailable: ${[...appEmojiCache.keys()].map(n => `:${n}:`).join(', ')}\nUse them naturally and sparingly.`;
}

const REACTION_CHANCE = parseFloat(process.env.REACTION_CHANCE || '0.3');

async function maybeReact(message) {
  if (!appEmojiCache.size || Math.random() > REACTION_CHANCE) return;
  try {
    const keys  = [...appEmojiCache.keys()];
    const name  = keys[Math.floor(Math.random() * keys.length)];
    const emoji = (await client.application.emojis.fetch()).find(e => e.name === name);
    if (emoji) await message.react(emoji);
  } catch { /* best-effort */ }
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(userId, username) {
  const memBlock   = buildMemoryBlock(userId, username);
  const emojiBlock = buildEmojiContext();
  return [
    `You are ${persona.name}.`, '',
    persona.description, '',
    `Personality traits: ${persona.traits.join(', ')}.`, '',
    `Tone: ${persona.tone}`, '',
    'Rules you must always follow:',
    ...persona.rules.map((r, i) => `${i + 1}. ${r}`), '',
    persona.extra_context ? `Additional context:\n${persona.extra_context}` : null, '',
    memBlock   ? `Custom memories you know:\n${memBlock}` : null, '',
    emojiBlock ? emojiBlock : null, '',
    'Stay in character at all times.',
    'Use memories naturally — never say "I remember" or "according to my memories".',
  ].filter(l => l !== null).join('\n').trim();
}

// ─── Conversation history ─────────────────────────────────────────────────────

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

// ─── Chat providers ───────────────────────────────────────────────────────────

async function chatGemini(channelId, msg, systemPrompt) {
  const model   = getGemini().getGenerativeModel({ model: activeChatModel(), systemInstruction: systemPrompt });
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
  const res      = await getAnthropic().messages.create({ model: activeChatModel(), system: systemPrompt, messages, max_tokens: 1024 });
  const reply    = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
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
  const history     = getHistory(channelId);
  const chatHistory = history.map(m => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content }));
  const res         = await getCohere().chat({ model: activeChatModel(), preamble: systemPrompt, chatHistory, message: msg });
  const reply       = res.text;
  pushHistory(history, msg, reply);
  return reply;
}

async function getAIResponse(channelId, userMessage, userId, username) {
  const systemPrompt = buildSystemPrompt(userId, username);
  const msg          = `[${username}]: ${userMessage}`;
  let   reply;
  switch (state.chatProvider) {
    case 'groq':      reply = await chatOpenAICompat(channelId, msg, systemPrompt, getGroq(), activeChatModel()); break;
    case 'openai':    reply = await chatOpenAICompat(channelId, msg, systemPrompt, getOpenAI(), activeChatModel()); break;
    case 'ollama':    reply = await chatOpenAICompat(channelId, msg, systemPrompt, getOpenAI((process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/v1', 'ollama'), activeChatModel()); break;
    case 'anthropic': reply = await chatAnthropic(channelId, msg, systemPrompt); break;
    case 'mistral':   reply = await chatMistral(channelId, msg, systemPrompt); break;
    case 'cohere':    reply = await chatCohere(channelId, msg, systemPrompt); break;
    case 'gemini': default: reply = await chatGemini(channelId, msg, systemPrompt); break;
  }
  const ts = new Date().toISOString();
  appendLog(channelId, { ts, userId, username, role: 'user',  content: userMessage });
  appendLog(channelId, { ts, userId: 'bot', username: persona.name, role: 'model', content: reply });
  return reply;
}

// ─── Log Q&A ──────────────────────────────────────────────────────────────────

async function queryLog(channelId, question) {
  const entries = readLog(channelId, 200);
  if (!entries.length) return 'No chat history found for this channel.';
  const logText = entries.map(e => `[${e.ts.slice(0, 16)}] ${e.username}: ${e.content}`).join('\n');
  const system  = 'You answer questions about a Discord chat log. Answer only from the log. Be concise. Say so if the answer is not there.';
  const userMsg = `Chat log:\n\n${logText}\n\nQuestion: ${question}`;
  switch (state.chatProvider) {
    case 'groq':      return (await getGroq().chat.completions.create({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    case 'openai':    return (await getOpenAI().chat.completions.create({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    case 'anthropic': return (await getAnthropic().messages.create({ model: activeChatModel(), system, messages: [{ role: 'user', content: userMsg }], max_tokens: 1024 })).content.filter(b => b.type === 'text').map(b => b.text).join('');
    case 'mistral':   return (await getMistral().chat.complete({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content;
    case 'cohere':    return (await getCohere().chat({ model: activeChatModel(), preamble: system, message: userMsg })).text;
    case 'ollama': {  const oc = getOpenAI((process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/v1', 'ollama'); return (await oc.chat.completions.create({ model: activeChatModel(), messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] })).choices[0].message.content; }
    case 'gemini': default: { const m = getGemini().getGenerativeModel({ model: activeChatModel(), systemInstruction: system }); return (await m.generateContent(userMsg)).response.text(); }
  }
}

// ─── Image generation ─────────────────────────────────────────────────────────

async function generateImage(prompt) {
  switch (state.imageProvider) {
    case 'none': throw new Error('Image generation is disabled. Use /imgprovider set to enable it.');
    case 'gemini-imagen': {
      const m = getGemini().getGenerativeModel({ model: activeImageModel() });
      const r = await m.generateImages({ prompt, numberOfImages: 1, outputOptions: { mimeType: 'image/png' } });
      if (!r.images?.length) throw new Error('No image returned from Imagen.');
      return { buffer: Buffer.from(r.images[0].imageBytes, 'base64'), ext: 'png' };
    }
    case 'together': {
      const res = await fetch('https://api.together.xyz/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: activeImageModel(), prompt, n: 1, width: 1024, height: 1024 }),
      });
      if (!res.ok) throw new Error(`Together API error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const url  = data.data?.[0]?.url;
      if (!url) throw new Error('No image URL from Together AI.');
      const imgRes = await fetch(url);
      return { buffer: Buffer.from(await imgRes.arrayBuffer()), ext: 'png' };
    }
    case 'openai-dall-e': {
      const res = await getOpenAI().images.generate({ model: activeImageModel(), prompt, n: 1, size: '1024x1024', response_format: 'b64_json' });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error('No image data from DALL-E.');
      return { buffer: Buffer.from(b64, 'base64'), ext: 'png' };
    }
    case 'stability': {
      const form = new URLSearchParams();
      form.append('text_prompts[0][text]', prompt); form.append('cfg_scale', '7');
      form.append('height', '1024'); form.append('width', '1024'); form.append('samples', '1');
      const res  = await fetch(`https://api.stability.ai/v1/generation/${activeImageModel()}/text-to-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.STABILITY_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!res.ok) throw new Error(`Stability API error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const b64  = data.artifacts?.[0]?.base64;
      if (!b64) throw new Error('No image data from Stability AI.');
      return { buffer: Buffer.from(b64, 'base64'), ext: 'png' };
    }
    default: throw new Error(`Unknown image provider: ${state.imageProvider}`);
  }
}

// ─── Slash command definitions ────────────────────────────────────────────────

const CHAT_PROVIDER_CHOICES   = Object.keys(PROVIDER_DEFAULTS).map(p => ({ name: p, value: p }));
const IMAGE_PROVIDER_CHOICES  = Object.keys(IMAGE_PROVIDER_DEFAULTS).map(p => ({ name: p, value: p }));

const commands = [

  // ── Image generation
  new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Generate an image with AI')
    .addStringOption(o => o.setName('prompt').setDescription('Describe the image').setRequired(true)),

  // ── Memories
  new SlashCommandBuilder()
    .setName('memory')
    .setDescription('Manage bot memories')
    .addSubcommand(s => s.setName('add').setDescription('Add a memory about a user')
      .addUserOption(o => o.setName('user').setDescription('Who this memory is about').setRequired(true))
      .addStringOption(o => o.setName('fact').setDescription('The fact to remember').setRequired(true)))
    .addSubcommand(s => s.setName('add-global').setDescription('[Owner] Add a memory about everyone')
      .addStringOption(o => o.setName('fact').setDescription('The fact to remember').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List memories')
      .addUserOption(o => o.setName('user').setDescription('View memories for a specific user (leave blank for your own)')))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a memory by index')
      .addStringOption(o => o.setName('scope').setDescription('"global" or a user ID').setRequired(true))
      .addIntegerOption(o => o.setName('index').setDescription('Index shown in /memory list').setRequired(true))),

  // ── Logs
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('View or search the chat log for this channel')
    .addSubcommand(s => s.setName('recent').setDescription('Show recent messages')
      .addIntegerOption(o => o.setName('count').setDescription('How many messages (default 20)').setMinValue(1).setMaxValue(50)))
    .addSubcommand(s => s.setName('search').setDescription('Search the log by keyword')
      .addStringOption(o => o.setName('keyword').setDescription('Word to search for').setRequired(true)))
    .addSubcommand(s => s.setName('ask').setDescription('Ask the AI a question about this channel\'s history')
      .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true))),

  // ── Status / info
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show the current AI provider and model'),

  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Show the current bot persona'),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear conversation memory for this channel (logs are preserved)'),

  // ── Provider management (owner)
  new SlashCommandBuilder()
    .setName('provider')
    .setDescription('[Owner] Manage the chat AI provider')
    .addSubcommand(s => s.setName('set').setDescription('Switch chat provider')
      .addStringOption(o => o.setName('name').setDescription('Provider name').setRequired(true).addChoices(...CHAT_PROVIDER_CHOICES))
      .addStringOption(o => o.setName('model').setDescription('Override model (leave blank for default)')))
    .addSubcommand(s => s.setName('list').setDescription('List all chat providers'))
    .addSubcommand(s => s.setName('models').setDescription('List free models for current provider')),

  new SlashCommandBuilder()
    .setName('imgprovider')
    .setDescription('[Owner] Manage the image generation provider')
    .addSubcommand(s => s.setName('set').setDescription('Switch image provider')
      .addStringOption(o => o.setName('name').setDescription('Provider name').setRequired(true).addChoices(...IMAGE_PROVIDER_CHOICES))
      .addStringOption(o => o.setName('model').setDescription('Override model (leave blank for default)')))
    .addSubcommand(s => s.setName('list').setDescription('List all image providers')),

  new SlashCommandBuilder()
    .setName('model')
    .setDescription('[Owner] Set the chat model directly')
    .addStringOption(o => o.setName('name').setDescription('Model name (e.g. llama-3.3-70b-versatile)').setRequired(true)),

  // ── Auth management (owner)
  new SlashCommandBuilder()
    .setName('auth')
    .setDescription('[Owner] Manage who can use the bot')
    .addSubcommand(s => s.setName('add').setDescription('Authorize a user')
      .addUserOption(o => o.setName('user').setDescription('User to authorize').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove authorization')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List authorized users')),

  // ── Keyword triggers (owner)
  new SlashCommandBuilder()
    .setName('trigger')
    .setDescription('[Owner] Manage keyword auto-replies')
    .addSubcommand(s => s.setName('add').setDescription('Add a keyword trigger and one of its replies')
      .addStringOption(o => o.setName('keyword').setDescription('The trigger word/phrase (case-insensitive)').setRequired(true))
      .addStringOption(o => o.setName('reply').setDescription('A reply to send when this keyword is detected').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove an entire keyword or a single reply')
      .addStringOption(o => o.setName('keyword').setDescription('The trigger keyword').setRequired(true))
      .addIntegerOption(o => o.setName('index').setDescription('Reply index to delete (omit to delete the whole keyword)')))
    .addSubcommand(s => s.setName('list').setDescription('List all keyword triggers')
      .addStringOption(o => o.setName('keyword').setDescription('Show replies for a specific keyword (omit to list all keywords)'))),

  // ── Reload persona (owner)
  new SlashCommandBuilder()
    .setName('reload')
    .setDescription('[Owner] Reload persona.json without restarting'),

].map(c => c.toJSON());

// ─── Register slash commands ──────────────────────────────────────────────────

async function registerCommands() {
  const rest      = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const clientId  = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    console.warn('⚠️  CLIENT_ID not set — slash commands will not be registered. Add it to your env vars.');
    return;
  }

  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`✅ ${commands.length} slash commands registered globally.`);
  } catch (err) {
    console.error('❌ Failed to register commands:', err.message);
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

// Send a potentially long reply via interaction (ephemeral = private to caller)
async function iReply(interaction, text, ephemeral = true) {
  const chunks = (text || '(empty)').match(/[\s\S]{1,1990}/g);
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: chunks[0], ephemeral });
    for (let i = 1; i < chunks.length; i++) await interaction.followUp({ content: chunks[i], ephemeral });
  } else {
    for (const chunk of chunks) await interaction.followUp({ content: chunk, ephemeral });
  }
}

// Send a long plain reply to a message
async function mReply(message, text) {
  const chunks = (text || '(empty)').match(/[\s\S]{1,1990}/g);
  let first = true;
  for (const chunk of chunks) {
    if (first) { await message.reply(chunk); first = false; }
    else { await message.channel.send(chunk); }
  }
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async c => {
  console.log(`✅ ${c.user.tag} online`);
  console.log(`🎭 Persona: ${persona.name}`);
  console.log(`🤖 Chat: ${state.chatProvider} / ${activeChatModel()}`);
  console.log(`🎨 Image: ${state.imageProvider} / ${activeImageModel()}`);
  console.log(`🔐 Authorized: ${loadAuthorized().join(', ') || '(none)'}`);
  await loadAppEmojis();
  await registerCommands();
  c.user.setPresence({
    activities: [{ name: persona.status || `as ${persona.name}`, type: ActivityType.Playing }],
    status: 'online',
  });
});

// ─── Slash command handler ────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId   = interaction.user.id;
  const username = interaction.user.username;
  const cmd      = interaction.commandName;
  const owner    = isOwner(userId);

  // /reload — owner only
  if (cmd === 'reload') {
    if (!owner) { await interaction.reply({ content: '🚫 Owner only.', ephemeral: true }); return; }
    try {
      persona = JSON.parse(fs.readFileSync(PERSONA_PATH, 'utf-8'));
      conversationHistory.clear();
      await interaction.reply({ content: `♻️ Persona reloaded as **${persona.name}**. Conversation memory cleared.`, ephemeral: true });
    } catch (e) { await interaction.reply({ content: `❌ ${e.message}`, ephemeral: true }); }
    return;
  }

  // /auth — owner only
  if (cmd === 'auth') {
    if (!owner) { await interaction.reply({ content: '🚫 Owner only.', ephemeral: true }); return; }
    const sub    = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');
    if (sub === 'list') {
      const ids = loadAuthorized();
      await iReply(interaction, ids.length ? `**🔐 Authorized users:**\n${ids.map(id => `• <@${id}>  \`${id}\``).join('\n')}` : '**🔐 Authorized users:** *none yet.*');
      return;
    }
    if (sub === 'add') {
      const ids = loadAuthorized();
      if (ids.includes(target.id)) { await interaction.reply({ content: `ℹ️ ${target.username} is already authorized.`, ephemeral: true }); return; }
      saveAuthorized([...ids, target.id]);
      await interaction.reply({ content: `✅ <@${target.id}> authorized.`, ephemeral: true });
      return;
    }
    if (sub === 'remove') {
      saveAuthorized(loadAuthorized().filter(id => id !== target.id));
      await interaction.reply({ content: `🗑️ <@${target.id}> removed.`, ephemeral: true });
      return;
    }
  }

  // /provider — owner only
  if (cmd === 'provider') {
    if (!owner) { await interaction.reply({ content: '🚫 Owner only.', ephemeral: true }); return; }
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const name  = interaction.options.getString('name');
      const model = interaction.options.getString('model') || '';
      state.chatProvider = name; state.chatModel = model;
      conversationHistory.clear(); saveState();
      await interaction.reply({ content: `✅ Chat provider → **${state.chatProvider}** / model → \`${activeChatModel()}\`. History cleared.`, ephemeral: true });
      return;
    }
    if (sub === 'list') {
      const list = Object.entries(PROVIDER_DEFAULTS).map(([p, m]) => `${p === state.chatProvider ? '✅' : '•'} **${p}** — default: \`${m}\``).join('\n');
      await iReply(interaction, `**Chat providers:**\n${list}`);
      return;
    }
    if (sub === 'models') {
      const models = FREE_MODELS[state.chatProvider] || [];
      if (!models.length) { await iReply(interaction, `No preset model list for **${state.chatProvider}**.`); return; }
      await iReply(interaction, `**Free/default models for ${state.chatProvider}:**\n${models.map((m, i) => `${i === 0 ? '⭐' : '•'} \`${m}\``).join('\n')}\n\nCurrent: \`${activeChatModel()}\``);
      return;
    }
  }

  // /model — owner only
  if (cmd === 'model') {
    if (!owner) { await interaction.reply({ content: '🚫 Owner only.', ephemeral: true }); return; }
    const name = interaction.options.getString('name');
    state.chatModel = name; conversationHistory.clear(); saveState();
    await interaction.reply({ content: `✅ Chat model → \`${state.chatModel}\`. History cleared.`, ephemeral: true });
    return;
  }

  // /imgprovider — owner only
  if (cmd === 'imgprovider') {
    if (!owner) { await interaction.reply({ content: '🚫 Owner only.', ephemeral: true }); return; }
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const name  = interaction.options.getString('name');
      const model = interaction.options.getString('model') || '';
      state.imageProvider = name; state.imageModel = model; saveState();
      await interaction.reply({ content: `✅ Image provider → **${state.imageProvider}** / model → \`${activeImageModel()}\`.`, ephemeral: true });
      return;
    }
    if (sub === 'list') {
      const list = Object.entries(IMAGE_PROVIDER_DEFAULTS).map(([p, m]) => `${p === state.imageProvider ? '✅' : '•'} **${p}** — default: \`${m || 'n/a'}\``).join('\n');
      await iReply(interaction, `**Image providers:**\n${list}`);
      return;
    }
  }

  // /trigger — owner only
  if (cmd === 'trigger') {
    if (!owner) { await interaction.reply({ content: '🚫 Owner only.', ephemeral: true }); return; }
    const sub     = interaction.options.getSubcommand();
    const keyword = interaction.options.getString('keyword')?.toLowerCase().trim();

    if (sub === 'add') {
      const reply = interaction.options.getString('reply');
      addTrigger(keyword, reply);
      const t = loadTriggers();
      await interaction.reply({ content: `✅ Trigger added for **"${keyword}"** — now has ${t[keyword].length} repl${t[keyword].length === 1 ? 'y' : 'ies'}.`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const index  = interaction.options.getInteger('index');  // null if omitted
      const result = removeTrigger(keyword, index ?? undefined);
      const msgs   = {
        deleted_keyword : `🗑️ Trigger **"${keyword}"** and all its replies removed.`,
        deleted_reply   : `🗑️ Reply #${index} removed from **"${keyword}"**.`,
        no_keyword      : `❌ No trigger found for **"${keyword}"**.`,
        no_index        : `❌ Index #${index} not found for **"${keyword}"**.`,
      };
      await interaction.reply({ content: msgs[result], ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const t = loadTriggers();
      if (keyword) {
        const replies = t[keyword];
        if (!replies?.length) { await interaction.reply({ content: `No trigger found for **"${keyword}"**.`, ephemeral: true }); return; }
        await iReply(interaction, `**Replies for "${keyword}":**\n${replies.map((r, i) => `\`[${i}]\` ${r}`).join('\n')}`);
      } else {
        const keys = Object.keys(t);
        if (!keys.length) { await interaction.reply({ content: 'No keyword triggers set yet.', ephemeral: true }); return; }
        await iReply(interaction, `**Keyword triggers (${keys.length}):**\n${keys.map(k => `• **"${k}"** — ${t[k].length} repl${t[k].length === 1 ? 'y' : 'ies'}`).join('\n')}\n\nUse \`/trigger list keyword:<word>\` to see replies.`);
      }
      return;
    }
  }

  // ── Auth gate for remaining commands ──────────────────────────────────────────

  if (!isAuthorized(userId)) {
    await interaction.reply({ content: "you're not on the list, sorry 🚫", ephemeral: true });
    return;
  }

  // /imagine
  if (cmd === 'imagine') {
    const prompt = interaction.options.getString('prompt');
    await interaction.deferReply({ ephemeral: false });
    try {
      const { buffer, ext } = await generateImage(prompt);
      const att = new AttachmentBuilder(buffer, { name: `image.${ext}` });
      await interaction.editReply({ content: `🎨 *${prompt}*`, files: [att] });
    } catch (err) {
      console.error('Image gen error:', err);
      await interaction.editReply(friendlyError(err));
    }
    return;
  }

  // /memory
  if (cmd === 'memory') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add-global') {
      if (!owner) { await interaction.reply({ content: '🚫 Only the owner can add global memories.', ephemeral: true }); return; }
      const fact = interaction.options.getString('fact');
      addMemory('global', fact);
      await interaction.reply({ content: `🧠 Global memory saved: "${fact}"`, ephemeral: true });
      return;
    }

    if (sub === 'add') {
      const target = interaction.options.getUser('user');
      const fact   = interaction.options.getString('fact');
      addMemory(target.id, fact);
      await interaction.reply({ content: `🧠 Memory saved for <@${target.id}>: "${fact}"`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const target   = interaction.options.getUser('user');
      const targetId = target?.id || userId;
      const m        = loadMemories();
      const entries  = m[targetId] || [];
      if (!entries.length) {
        await interaction.reply({ content: `No memories for ${target ? `<@${target.id}>` : 'you'}.`, ephemeral: true });
        return;
      }
      await iReply(interaction, `**Memories for ${target ? `<@${target.id}>` : 'you'}:**\n${entries.map((e, i) => `\`[${i}]\` ${e}`).join('\n')}`);
      return;
    }

    if (sub === 'remove') {
      const scope = interaction.options.getString('scope');
      const idx   = interaction.options.getInteger('index');
      // Non-owners can only remove user-scoped memories, not global
      if (scope === 'global' && !owner) { await interaction.reply({ content: '🚫 Only the owner can remove global memories.', ephemeral: true }); return; }
      await interaction.reply({ content: removeMemory(scope, idx) ? `🗑️ Memory #${idx} removed from **${scope}**.` : `❌ Memory #${idx} not found in **${scope}**.`, ephemeral: true });
      return;
    }
  }

  // /logs
  if (cmd === 'logs') {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'search') {
      const keyword = interaction.options.getString('keyword');
      const results = searchLog(interaction.channelId, keyword).slice(-20);
      if (!results.length) { await interaction.editReply(`🔍 Nothing found for "${keyword}".`); return; }
      await iReply(interaction, `🔍 **Results for "${keyword}":**\n${results.map(e => `[\`${e.ts.slice(0,16)}\`] **${e.username}**: ${e.content.slice(0,120)}`).join('\n')}`);
      return;
    }

    if (sub === 'ask') {
      const question = interaction.options.getString('question');
      try {
        const answer = await queryLog(interaction.channelId, question);
        await iReply(interaction, `🗂️ ${answer}`);
      } catch (err) {
        await interaction.editReply(friendlyError(err));
      }
      return;
    }

    // recent
    const count   = interaction.options.getInteger('count') || 20;
    const entries = readLog(interaction.channelId, count);
    if (!entries.length) { await interaction.editReply('📋 No log history yet.'); return; }
    await iReply(interaction, `📋 **Last ${entries.length} messages:**\n${entries.map(e => `[\`${e.ts.slice(0,16)}\`] **${e.username}**: ${e.content.slice(0,120)}`).join('\n')}`);
    return;
  }

  // /status
  if (cmd === 'status') {
    await interaction.reply({
      content: `🤖 **Chat:** \`${state.chatProvider}\` / \`${activeChatModel()}\`\n🎨 **Image:** \`${state.imageProvider}\` / \`${activeImageModel()}\``,
      ephemeral: true,
    });
    return;
  }

  // /persona
  if (cmd === 'persona') {
    const desc = persona.description.slice(0, 300);
    await interaction.reply({ content: `**🎭 ${persona.name}**\n> ${desc}${persona.description.length > 300 ? '…' : ''}`, ephemeral: true });
    return;
  }

  // /clear
  if (cmd === 'clear') {
    conversationHistory.delete(interaction.channelId);
    await interaction.reply({ content: '🧹 Conversation memory cleared. (Logs are preserved.)', ephemeral: true });
    return;
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────
// Responds when:
//   • The bot is @mentioned
//   • The message is a DM
//   • The message is a reply to one of the bot's own messages
//   • RESPOND_TO_ALL=true is set

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  const botMentioned  = message.mentions.has(client.user);
  const isDM          = message.channel.type === 1;
  const isReplyToBot  = message.reference?.messageId
    ? (await message.channel.messages.fetch(message.reference.messageId).catch(() => null))?.author?.id === client.user.id
    : false;

  if (!botMentioned && !isDM && !isReplyToBot && process.env.RESPOND_TO_ALL !== 'true') return;
  if (!isAuthorized(message.author.id)) return;

  // Strip the @mention from the text so triggers/AI don't see it
  const userMessage = message.content.replace(`<@${client.user.id}>`, '').trim();
  if (!userMessage) return;

  // ── Keyword trigger check (only fires on @mention or reply-to-bot) ──────────
  // Triggers don't fire in RESPOND_TO_ALL mode for non-mentions to avoid spam.
  if (botMentioned || isDM || isReplyToBot) {
    const triggerReply = matchTrigger(userMessage);
    if (triggerReply) {
      await message.reply(resolveEmojis(triggerReply));
      await maybeReact(message);
      return; // skip AI entirely
    }
  }

  // ── Normal AI response ───────────────────────────────────────────────────────
  await message.channel.sendTyping();
  try {
    const reply = await getAIResponse(message.channelId, userMessage, message.author.id, message.author.username);
    await mReply(message, resolveEmojis(reply));
    await maybeReact(message);
  } catch (err) {
    console.error('AI error:', err);
    await message.reply(friendlyError(err));
  }
});

client.login(process.env.DISCORD_TOKEN);
