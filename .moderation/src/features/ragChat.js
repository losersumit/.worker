import '../utils/loadEnv.js';
import { groqChatCompletion } from '../clients/groq.js';
import { findFaqAnswer, embed } from '../systems/faq.js';
import { runAgentLoop } from '../systems/agentLoop.js';
import config from '../config.js';

const CHAT_MODEL = config.ai.model;
const CHAT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.6);
const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 512);
const AUTO_REPLY_COOLDOWN_MS = Number(process.env.RAG_AUTO_REPLY_COOLDOWN_MS || 25000);

const CHUNK_MIN = 5;
const CHUNK_MAX = 10;
const CHUNK_IDLE_MS = 2 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = Number(process.env.RAG_LOOKBACK_HOURS || 24);

const channelBuffers = new Map();
const perUserConversations = new Map();
const lastContextByUser = new Map();
const rateLimiter = new Map();
const channelAutoReplyAt = new Map();

const BASE_PERSONALITY = `You are Worker, a regular support provider and a casual Chatbot in a Virtual Trucking Company National Mobility Command [NMC] for the game Truckers of Europe 3 [TOE3] server.
Tone:
- Human, brief, natural.
- Dry humor / deadpan is fine.
- No corporate style, no "As an AI" wording.
- Do Not mention anything like "I am support provider." You are a human who knows everything.
- Usually 1-3 sentences unless user asked for detail.
- If context is missing, say so plainly.
- You are also allowed to chat casually and non server related things.`;

function sanitizeText(input) {
    return String(input || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 2000);
}

function getImageAttachment(message) {
    if (!message?.attachments?.size) return null;
    const att = message.attachments.find(a => (a.contentType && a.contentType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name || ''));
    return att || null;
}

async function reactToImage(message, imageAttachment) {
    if (!imageAttachment?.url) return;

    // Use the vision model configured in config.js
    const modelToUse = config.ai.visionModel || config.ai.fallbackVisionModel;

    // Get the list of server emojis (name:id) for the model to choose from
    const guildEmojis = message.guild?.emojis?.cache;
    const emojiListStr = guildEmojis ? guildEmojis.map(e => `${e.name}:${e.id}`).join(', ') : '';

    // Build a prompt that asks the model to classify the image and output an emoji name or ID.
    const prompt = `You are an image classifier for a virtual trucking company NMC. Examine the image and decide:
- If the image contains a truck and is a high‑quality cinematic shot with good lighting/editing, respond with ONLY the word "goated".
- If the image contains a truck but is a low‑quality, bad lighting, or standard/ugly shot, respond with ONLY the word "meeditation".
- If the image does NOT contain a truck, you MUST choose the most appropriate existing server emoji from the list below and respond ONLY with its numeric ID.
Here is the list of available server emojis (name:id): ${emojiListStr}

Response requirements:
- Respond with EXACTLY one word ("goated" or "meeditation") or EXACTLY one numeric emoji ID from the list.
- Do NOT output any other words, punctuation, markdown formatting, or explanations.`;

    // Call the vision model with the prompt
    const data = await groqChatCompletion({
        model: modelToUse,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageAttachment.url } }] }],
        temperature: 0.1,
        max_tokens: 15,
    });

    const rawResponse = data?.choices?.[0]?.message?.content?.trim() || '';
    const response = rawResponse.toLowerCase();

    // Determine which emoji to react with
    let emojiToReact = null;
    if (guildEmojis) {
        // Direct matches for the two special cases
        if (response.includes('goated')) {
            emojiToReact = guildEmojis.find(e => e.name === 'goated');
        } else if (response.includes('meeditation')) {
            emojiToReact = guildEmojis.find(e => e.name === 'meeditation');
        } else {
            // Assume the model returned an ID; try to find that emoji
            const idMatch = response.match(/\d{17,}/);
            if (idMatch) {
                const id = idMatch[0];
                emojiToReact = guildEmojis.get(id);
            }
        }

        // Guaranteed fallback if we couldn't resolve: it MUST choose a server emoji
        if (!emojiToReact) {
            console.warn(`[RAG] Vision response "${rawResponse}" could not be mapped. Guaranteeing choice...`);
            emojiToReact = guildEmojis.find(e => e.name === 'goated') || 
                           guildEmojis.find(e => e.name === 'meeditation') || 
                           guildEmojis.first();
        }
    }

    if (!emojiToReact) {
        console.warn('[RAG] No server emojis available to react with.');
        return;
    }

    try {
        await message.react(emojiToReact);
    } catch (reactErr) {
        console.error('[RAG] Failed to react with chosen emoji:', reactErr.message);
    }
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

async function getVerifiedIdentity(supabase, guildId, userId) {
    if (!guildId || !userId) return null;
    const { data, error } = await supabase
        .from('verified_identities')
        .select('guild_id,user_id,username,is_owner,is_admin,role_names,updated_at')
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        console.error('[RAG] verified identity fetch failed:', error.message);
        return null;
    }

    return data || null;
}

async function storeRagMessage(supabase, message) {
    const content = sanitizeText(message.content);
    const image = getImageAttachment(message);
    const imageToken = image ? ` [image:${image.url}]` : '';
    const finalContent = `${content}${imageToken}`.trim();
    if (!finalContent) return null;

    const guild = message.guild;
    const member = message.member;
    const roleNames = member?.roles?.cache
        ? member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 30)
        : [];

    const row = {
        message_id: message.id,
        user_id: message.author.id,
        username: member?.displayName || message.author.globalName || message.author.username,
        channel_id: message.channel.id,
        channel_name: message.channel?.name || 'DM',
        content: finalContent,
        created_at: message.createdAt.toISOString(),
        guild_id: guild?.id || null,
        role_names: roleNames,
        is_owner: guild ? guild.ownerId === message.author.id : false,
        is_admin: member ? Boolean(member.permissions?.has('Administrator')) : false,
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

    let embedding = null;
    try {
        embedding = await embed(text, 'search_document');
    } catch (err) {
        console.error('[RAG] chunk embed failed:', err.message);
    }

    const payload = {
        channel_id: channelId,
        start_time: rows[0].created_at,
        end_time: rows[rows.length - 1].created_at,
        text,
        embedding,
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
    const qVec = await embed(question, 'search_query').catch(() => null);
    const since = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    const fetchPromises = [
        supabase
            .from('rag_summaries')
            .select('channel_id, summary_text, hour_bucket, created_at')
            .eq('channel_id', channelId)
            .gte('hour_bucket', since)
            .order('hour_bucket', { ascending: false })
            .limit(72)
    ];

    if (qVec) {
        fetchPromises.push(
            supabase.rpc('match_rag_chunks', {
                query_embedding: qVec,
                match_threshold: 0.15,
                match_count: 5
            })
        );
    } else {
        fetchPromises.push(Promise.resolve({ data: [] }));
    }

    const [summariesRes, chunksRes] = await Promise.all(fetchPromises);

    const chunkHits = (chunksRes.data || [])
        .map(r => ({ type: 'chunk', text: r.text, at: r.end_time || r.start_time, score: r.similarity || 1 }))
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

function formatVerifiedIdentity(verified) {
    if (!verified) return 'No verified identity found for this user.';
    const roles = Array.isArray(verified.role_names) && verified.role_names.length ? verified.role_names.join(', ') : 'none';
    return [
        `username: ${verified.username || 'unknown'}`,
        `is_owner: ${Boolean(verified.is_owner)}`,
        `is_admin: ${Boolean(verified.is_admin)}`,
        `roles: ${roles}`,
    ].join('\n');
}

function buildPrompt(question, context, username, verifiedIdentity, history, rawChannelHistory) {
    const contextBlock = context.length
        ? context.map((c, idx) => `[${idx + 1}] (${c.type}) ${c.text}`).join('\n\n')
        : 'No relevant context found in DB.';

    let dialogueBlock = 'No recent conversation.';
    if (history && history.length > 0) {
        dialogueBlock = history.map(turn => `${turn.name}: ${turn.text}`).join('\n');
    }

    return `${BASE_PERSONALITY}

CURRENT USER: ${username}

VERIFIED IDENTITY (trusted authority source):
${formatVerifiedIdentity(verifiedIdentity)}

RECENT RAW CHANNEL HISTORY (Last 15 messages):
${rawChannelHistory || 'No recent channel messages.'}

RETRIEVED CHANNEL CONTEXT (Past 24 hours of chat):
${contextBlock}

RECENT DIALOGUE WITH CURRENT USER:
${dialogueBlock}

QUESTION:
${question}`;
}

function pushConversationTurn(message, promptText) {
    const key = `${message.channel.id}:${message.author.id}`;
    if (!perUserConversations.has(key)) perUserConversations.set(key, []);
    const history = perUserConversations.get(key);
    const userName = message.member?.displayName || message.author.globalName || message.author.username;
    history.push({ role: 'user', name: userName, text: sanitizeText(promptText) || '[empty]' });
    while (history.length > 16) history.shift();
    return { key, history, userName };
}

function pushAssistantTurn(key, replyText) {
    const history = perUserConversations.get(key);
    if (!history) return;
    history.push({ role: 'assistant', name: 'Worker', text: sanitizeText(replyText) || '...' });
    while (history.length > 16) history.shift();
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

    try {
        await message.channel.sendTyping();
    } catch { }

    try {
        await runAgentLoop(message, client);
    } catch (err) {
        console.error('[RAG] Agent loop error:', err);
        await message.reply('Something went wrong. Try again.').catch(() => {});
    }
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

    // Check if channel is ignored for chat
    const ignoredChannels = process.env.IGNORED_CHAT_CHANNELS
        ? process.env.IGNORED_CHAT_CHANNELS.split(',').map(id => id.trim())
        : [];

    if (ignoredChannels.includes(message.channel.id)) {
        return; // Completely ignore tracking and chatting in this channel
    }

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
    const image = getImageAttachment(message);

    // Rule 1: Always react to images (Auto-Emoji Vision)
    if (image) {
        // Fire and forget the reaction, logging any unhandled errors
        reactToImage(message, image).catch(err => {
            console.error('[RAG] Error in reactToImage:', err);
        });
    }

    // Rule 2: Explicitly talking to the bot (Ping or Reply)
    if (mentioned || repliedToBot) {
        const q = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim() || 'Hey!';
        await askWithContext(message, client, q);
        return;
    }

    // Rule 3: Ambient fallback - ONLY speak if it's an FAQ answer
    /*
        if (content.length > 10 && content.includes('?')) {
            try {
                const faqText = await findFaqAnswer(content);
                if (faqText) {
                    // If we found a high-confidence FAQ answer, speak up ambiently
                    if (autoReplyAllowed(message.channel.id)) {
                        markAutoReply(message.channel.id);
                        await message.reply(faqText);
                    }
                }
            } catch (err) {
                console.error('[RAG] Ambient FAQ check error:', err.message);
            }
        }
    */
}
