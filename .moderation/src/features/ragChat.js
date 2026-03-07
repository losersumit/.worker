import { groqChatCompletion } from '../clients/groq.js';
import { findFaqAnswer } from '../systems/faq.js';

const CHAT_MODEL = process.env.CHAT_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct';
const CHAT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.6);
const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 512);
const AUTO_REPLY_COOLDOWN_MS = Number(process.env.RAG_AUTO_REPLY_COOLDOWN_MS || 25000);

const CHUNK_MIN = 5;
const CHUNK_MAX = 10;
const CHUNK_IDLE_MS = 2 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = Number(process.env.RAG_LOOKBACK_HOURS || 24);

const channelBuffers = new Map();
const lastContextByUser = new Map();
const rateLimiter = new Map();
const channelAutoReplyAt = new Map();

const BASE_PERSONALITY = `You are Worker, a regular member in this Discord server.
Tone:
- Human, brief, natural.
- Dry humor / deadpan is fine.
- No corporate style, no "As an AI" wording.
- Usually 1-3 sentences unless user asked for detail.
- If context is missing, say so plainly.`;

function sanitizeText(input) {
    return String(input || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 2000);
}

function getImageAttachment(message) {
    if (!message?.attachments?.size) return null;
    const att = message.attachments.find(a => (a.contentType && a.contentType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name || ''));
    return att || null;
}

function shouldAutoReply(message, text) {
    const hasImage = Boolean(getImageAttachment(message));
    if (hasImage) return true;

    const lower = text.toLowerCase();
    if (text.includes('?')) return true;

    const asks = ['why', 'what', 'who', 'when', 'where', 'how', 'help', 'explain', 'anyone know', 'can someone', 'worker'];
    if (asks.some(k => lower.includes(k))) return true;

    const serverEventKeywords = ['muted', 'banned', 'warned', 'economy', 'donate', 'gamble', 'argument', 'summary'];
    if (serverEventKeywords.some(k => lower.includes(k))) return true;

    return false;
}

function autoReplyAllowed(channelId) {
    const last = channelAutoReplyAt.get(channelId) || 0;
    return (Date.now() - last) >= AUTO_REPLY_COOLDOWN_MS;
}

function markAutoReply(channelId) {
    channelAutoReplyAt.set(channelId, Date.now());
}

function isRateLimited(userId) {
    const now = Date.now();
    const bucket = rateLimiter.get(userId) || [];
    const recent = bucket.filter(t => now - t < 60000);
    if (recent.length >= 8) return true;
    recent.push(now);
    rateLimiter.set(userId, recent);
    return false;
}

async function isReplyToBot(message, client) {
    if (!message.reference?.messageId) return false;
    try {
        const ref = await message.channel.messages.fetch(message.reference.messageId);
        return ref?.author?.id === client.user.id;
    } catch {
        return false;
    }
}

async function storeRagMessage(supabase, message) {
    const content = sanitizeText(message.content);
    const image = getImageAttachment(message);
    const imageToken = image ? ` [image:${image.url}]` : '';
    const finalContent = `${content}${imageToken}`.trim();
    if (!finalContent) return null;

    const row = {
        message_id: message.id,
        user_id: message.author.id,
        username: message.member?.displayName || message.author.globalName || message.author.username,
        channel_id: message.channel.id,
        channel_name: message.channel?.name || 'DM',
        content: finalContent,
        created_at: message.createdAt.toISOString(),
    };

    await supabase.from('rag_messages').upsert(row, { onConflict: 'message_id', ignoreDuplicates: true });
    return row;
}

async function flushChunkIfReady(supabase, channelId, force = false) {
    const buf = channelBuffers.get(channelId);
    if (!buf || buf.messages.length < CHUNK_MIN) return;

    const age = Date.now() - (buf.lastAt || 0);
    if (!force && buf.messages.length < CHUNK_MAX && age < CHUNK_IDLE_MS) return;

    const take = Math.min(CHUNK_MAX, buf.messages.length);
    const rows = buf.messages.splice(0, take);
    const text = rows.map(r => `${r.username}: ${r.content}`).join('\n');

    const payload = {
        channel_id: channelId,
        start_time: rows[0].created_at,
        end_time: rows[rows.length - 1].created_at,
        text,
        created_at: new Date().toISOString(),
    };

    await supabase.from('rag_chunks').insert(payload);
}

function scoreRow(question, text) {
    const terms = sanitizeText(question).toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const hay = sanitizeText(text).toLowerCase();
    let score = 0;
    for (const term of terms) if (hay.includes(term)) score++;
    return score;
}

async function retrieveContext(supabase, question, channelId) {
    const since = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    const [chunksRes, summariesRes] = await Promise.all([
        supabase
            .from('rag_chunks')
            .select('channel_id, text, start_time, end_time, created_at')
            .eq('channel_id', channelId)
            .gte('end_time', since)
            .order('end_time', { ascending: false })
            .limit(300),
        supabase
            .from('rag_summaries')
            .select('channel_id, summary_text, hour_bucket, created_at')
            .eq('channel_id', channelId)
            .gte('hour_bucket', since)
            .order('hour_bucket', { ascending: false })
            .limit(72)
    ]);

    const chunkHits = (chunksRes.data || [])
        .map(r => ({ type: 'chunk', text: r.text, at: r.end_time, score: scoreRow(question, r.text) }))
        .filter(r => r.score > 0);

    const summaryHits = (summariesRes.data || [])
        .map(r => ({ type: 'summary', text: r.summary_text, at: r.hour_bucket, score: scoreRow(question, r.summary_text) }))
        .filter(r => r.score > 0);

    const faq = await findFaqAnswer(question).catch(() => null);
    const merged = [...chunkHits, ...summaryHits]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    if (faq) merged.unshift({ type: 'faq', text: faq, at: new Date().toISOString(), score: 999 });
    return merged.slice(0, 6);
}

function buildPrompt(question, context, username) {
    const contextBlock = context.length
        ? context.map((c, idx) => `[${idx + 1}] (${c.type}) ${c.text}`).join('\n\n')
        : 'No relevant context found in DB.';

    return `${BASE_PERSONALITY}

CURRENT USER: ${username}

RETRIEVED CONTEXT:
${contextBlock}

QUESTION:
${question}`;
}

async function askWithContext(message, client, question) {
    if (!client.supabase) {
        await message.reply('RAG is not configured: missing Supabase client.');
        return;
    }

    if (isRateLimited(message.author.id)) {
        await message.reply('Rate limit hit. Try again in a minute.');
        return;
    }

    const context = await retrieveContext(client.supabase, question, message.channel.id);
    lastContextByUser.set(message.author.id, context);

    const username = message.member?.displayName || message.author.globalName || message.author.username;
    const prompt = buildPrompt(question, context, username);

    const image = getImageAttachment(message);
    let modelToUse = CHAT_MODEL;
    let userContent = prompt;

    if (image) {
        const { default: config } = await import('../config.js');
        modelToUse = config.ai.visionModel || 'llama-3.2-11b-vision-preview';
        userContent = [
            { type: 'text', text: `${prompt}\n\nAlso analyze the attached image if relevant.` },
            { type: 'image_url', image_url: { url: image.url } }
        ];
    }

    const data = await groqChatCompletion({
        model: modelToUse,
        messages: [{ role: 'user', content: userContent }],
        temperature: CHAT_TEMPERATURE,
        max_tokens: CHAT_MAX_TOKENS,
    });

    const answer = data?.choices?.[0]?.message?.content?.trim() || 'No answer generated.';
    await message.reply(answer);
}

async function buildHourlySummaryForChannel(supabase, channelId, startIso, endIso) {
    const { data } = await supabase
        .from('rag_messages')
        .select('username, content, created_at')
        .eq('channel_id', channelId)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: true })
        .limit(300);

    if (!data || data.length === 0) return;

    const transcript = data.map(r => `${r.username}: ${r.content}`).join('\n');
    const resp = await groqChatCompletion({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: `${BASE_PERSONALITY}\n\nSummarize this one-hour server discussion in concise bullets:\n\n${transcript}` }],
        temperature: 0.2,
        max_tokens: 300,
    });

    const summary = resp?.choices?.[0]?.message?.content?.trim();
    if (!summary) return;

    await supabase.from('rag_summaries').upsert({
        channel_id: channelId,
        hour_bucket: startIso,
        summary_text: summary,
        created_at: new Date().toISOString(),
    }, { onConflict: 'channel_id,hour_bucket' });
}

export function scheduleRagHourlySummaries(client) {
    if (!client?.supabase) return;

    const run = async () => {
        const end = new Date();
        end.setMinutes(0, 0, 0);
        const start = new Date(end.getTime() - 60 * 60 * 1000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();

        const { data } = await client.supabase
            .from('rag_messages')
            .select('channel_id')
            .gte('created_at', startIso)
            .lt('created_at', endIso)
            .limit(2000);

        const channels = [...new Set((data || []).map(r => r.channel_id))];
        for (const channelId of channels) {
            await buildHourlySummaryForChannel(client.supabase, channelId, startIso, endIso)
                .catch(err => console.error('[RAG] hourly summary failed:', channelId, err.message));
        }
    };

    setInterval(() => {
        run().catch(err => console.error('[RAG] hourly summary run error:', err.message));
    }, 60 * 60 * 1000);
}

export async function handleRagChat(message, client) {
    if (!client.supabase) return;

    const stored = await storeRagMessage(client.supabase, message);
    if (stored) {
        const channelId = stored.channel_id;
        if (!channelBuffers.has(channelId)) channelBuffers.set(channelId, { messages: [], lastAt: 0 });
        const buf = channelBuffers.get(channelId);
        buf.messages.push(stored);
        buf.lastAt = Date.now();

        await flushChunkIfReady(client.supabase, channelId, false);
    }

    const content = sanitizeText(message.content);

    const mentioned = message.mentions.has(client.user);
    const repliedToBot = await isReplyToBot(message, client);
    const shouldAuto = shouldAutoReply(message, content);

    if (mentioned || repliedToBot) {
        const q = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim() || 'Help me with recent server context.';
        await askWithContext(message, client, q);
        return;
    }

    // Human-like ambient behavior: answer without explicit ping when likely needed.
    if (shouldAuto && autoReplyAllowed(message.channel.id)) {
        markAutoReply(message.channel.id);
        const autoQuestion = content || 'React to the latest image or update naturally with server context.';
        await askWithContext(message, client, autoQuestion);
    }
}
