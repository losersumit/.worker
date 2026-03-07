import dotenv from 'dotenv';
import express from 'express';
import { Client, GatewayIntentBits } from 'discord.js';
import { setupMessageListener } from './ingestion/messageListener.js';
import { Chunker } from './rag/chunker.js';
import { embedText, sha256 } from './rag/embed.js';
import { query } from './db/db.js';
import { retrieveContext } from './rag/retrieve.js';
import { buildPrompt } from './ai/promptBuilder.js';
import { generateReply } from './ai/generateReply.js';
import { startHourlySummaries } from './rag/summarizer.js';

dotenv.config();

if (!process.env.DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN');

const PREFIX = process.env.DISCORD_PREFIX || '!';
const PORT = Number(process.env.PORT || 3000);
const chunker = new Chunker();
const contextCache = new Map();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;
const userCalls = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const history = userCalls.get(userId) || [];
  const recent = history.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  userCalls.set(userId, recent);
  return false;
}

async function saveChunk(chunk) {
  const hash = sha256(`${chunk.channel_id}|${chunk.start_time}|${chunk.end_time}|${chunk.text}`);
  const existing = await query('SELECT chunk_id FROM chunks WHERE content_hash = $1 LIMIT 1', [hash]);
  if ((existing.rows || []).length) return;

  const embedding = await embedText(chunk.text);
  if (!embedding) return;

  await query(
    `INSERT INTO chunks (channel_id, start_time, end_time, text, content_hash, embedding)
     VALUES ($1,$2,$3,$4,$5,$6::vector)
     ON CONFLICT (content_hash) DO NOTHING`,
    [chunk.channel_id, chunk.start_time, chunk.end_time, chunk.text, hash, `[${embedding.join(',')}]`]
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

setupMessageListener(client, async (stored, rawMessage) => {
  const chunk = chunker.addMessage(stored);
  if (chunk) await saveChunk(chunk);

  for (const staleChunk of chunker.flushStale()) {
    await saveChunk(staleChunk);
  }

  if (!rawMessage.content.startsWith(PREFIX)) return;

  const [command, ...rest] = rawMessage.content.trim().split(' ');

  if (command === `${PREFIX}ask`) {
    if (isRateLimited(rawMessage.author.id)) {
      await rawMessage.reply('Rate limit hit. Please wait a minute and try again.');
      return;
    }

    const question = rest.join(' ').trim();
    if (!question) {
      await rawMessage.reply('Usage: !ask <question>');
      return;
    }

    const context = await retrieveContext(question, {
      channelId: rawMessage.channel.id,
      hours: 24,
      limit: 5
    });

    contextCache.set(rawMessage.id, context);

    const prompt = buildPrompt({ question, context });
    const answer = await generateReply(prompt);
    await rawMessage.reply(answer);
  }

  if (command === `${PREFIX}summary`) {
    const recent = await query(
      `SELECT username, content, created_at
       FROM messages
       WHERE channel_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [rawMessage.channel.id]
    );

    const text = (recent.rows || [])
      .reverse()
      .map((m) => `${m.username}: ${m.content}`)
      .join('\n');

    const summaryPrompt = `Summarize the following 100 latest messages from this Discord channel:\n\n${text}`;
    const summary = await generateReply(summaryPrompt);
    await rawMessage.reply(summary);
  }

  if (command === `${PREFIX}context`) {
    const ctx = contextCache.get(rawMessage.id);
    if (!ctx || !ctx.length) {
      await rawMessage.reply('No cached retrieval context for your latest query.');
      return;
    }

    const formatted = ctx
      .map((c, i) => `[${i + 1}] (${c.source}) ${c.text.slice(0, 250)}`)
      .join('\n\n');

    await rawMessage.reply(`Retrieved context:\n${formatted.slice(0, 1900)}`);
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/ask', async (req, res) => {
  try {
    const { question, channelId, hours = 24 } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question is required' });

    const context = await retrieveContext(question, { channelId: channelId || null, hours, limit: 5 });
    const prompt = buildPrompt({ question, context });
    const answer = await generateReply(prompt);
    return res.json({ answer, context });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});

startHourlySummaries();
client.login(process.env.DISCORD_TOKEN);
