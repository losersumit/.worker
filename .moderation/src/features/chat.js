import { groqChatCompletion } from '../clients/groq.js';
import { findFaqAnswer } from '../systems/faq.js';
import { getMemories, getRecentServerEvents, formatMemoryContext, extractAndSaveMemories } from '../systems/memory.js';
import { getChannelBuffer } from './ambient.js';

// ===== NMC-style mention chat + FAQ =====
const histories = new Map();
const lastAccess = new Map(); // Track last access time for cleanup
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 12);
const HISTORY_TTL = 3600000; // 1 hour cleanup

// Cleanup interval for chat history (prevents memory leaks)
setInterval(() => {
    const now = Date.now();
    for (const [channelId, time] of lastAccess.entries()) {
        if (now - time > HISTORY_TTL) {
            histories.delete(channelId);
            lastAccess.delete(channelId);
        }
    }
}, 300000); // Check every 5 minutes

const CHAT_MODEL =
    process.env.CHAT_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct';
const CHAT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.7);
const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 512);

const COMPANY_NAME = process.env.COMPANY_NAME || 'the community';
const COMPANY_SHORT = process.env.COMPANY_SHORT || '';

// Commander (boss) Discord ID
const COMMANDER_ID = '1084255828107853844';

// Role hierarchy for rank detection (checked top-down, first match wins)
const RANK_ROLES = [
    { id: '1475314856184778835', name: 'Senior Mobility Operator' },
    { id: '1475314865878077603', name: 'Field Operator' },
    { id: '1475314870802055421', name: 'Operator' },
    { id: '1463184412937289973', name: 'Enlisted' },
    { id: '1448029031672053900', name: 'Visitor' },
];

/**
 * Resolve the highest rank a member holds from the RANK_ROLES list.
 * @param {GuildMember} member
 * @returns {string} The rank name, or 'Unknown' if none matched.
 */
function resolveRank(member) {
    if (!member?.roles?.cache) return 'Unknown';
    for (const rank of RANK_ROLES) {
        if (member.roles.cache.has(rank.id)) return rank.name;
    }
    return 'Unknown';
}

const BASE_SYSTEM_PROMPT = `You are "Worker", the AI assistant for ${COMPANY_NAME}${COMPANY_SHORT ? ` (${COMPANY_SHORT})` : ''} — a Virtual Trucking Company (VTC) in the mobile game Truckers of Europe 3 (TOE3).

IDENTITY:
- The Commander (Supreme Commander / Boss) of NMC is <@${COMMANDER_ID}>. Show respect to the Commander.
- You handle economy, moderation, support, and general banter.

PERSONALITY:
- You have OPINIONS. You love the Volcano VN ("absolute beast") and think the Stream ST is overrated.
- You respect anyone driving the 5×3 oversize trailer — "real truckers only."
- You have a dry, slightly sarcastic sense of humor. Think deadpan wit, not cringe.
- You tease people who lose at gambling — but congratulate winners.
- You're competitive about the economy leaderboard and like to hype rivalries.
- Occasionally drop trucking slang: "keep it between the ditches", "rubber side down", "hammer down."

RULES:
- Keep replies brief (1-3 sentences usually). Longer ONLY if someone asks a detailed question.
- Sound human. NO asterisk actions (*waves*). NO "As an AI". NO corporate tone.
- You can use emoji sparingly — don't overdo it.
- If someone references a memory you have about them, work it in naturally.
- If you don't know something, just say so.
`;

function getMoodString() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "- It's morning. You're chill and caffeinated. Brief responses.";
    if (hour >= 12 && hour < 17) return "- It's afternoon. You're energetic and engaged. Happy to chat.";
    if (hour >= 17 && hour < 22) return "- It's evening. You're relaxed and witty. Peak banter mode.";
    return "- It's late night. You're laid-back and philosophical. Shorter replies.";
}

/**
 * Build the dynamic system prompt with current user context + mood.
 */
function buildSystemPrompt(member, user) {
    const rank = resolveRank(member);
    const isCommander = user.id === COMMANDER_ID;
    const nameToUse = member?.displayName || user?.globalName || user?.username;
    const userLabel = isCommander
        ? `The Commander (${nameToUse})`
        : `${nameToUse}`;

    return BASE_SYSTEM_PROMPT
        + `\nMOOD (current):\n${getMoodString()}\n`
        + `\nCURRENT USER CONTEXT:\n- Speaking to: ${userLabel}\n- Their rank: ${rank}${isCommander ? ' (Supreme Commander — highest authority)' : ''}\n`;
}

function buildChatMessages(history, prompt) {
    const messages = [{ role: 'system', content: BASE_SYSTEM_PROMPT }];
    for (const h of history) messages.push({ role: h.role, content: h.text });
    messages.push({ role: 'user', content: prompt });
    return messages;
}

async function callGroqChat(messages) {
    const data = await groqChatCompletion({
        model: CHAT_MODEL,
        messages,
        temperature: CHAT_TEMPERATURE,
        max_tokens: CHAT_MAX_TOKENS
    });
    return data?.choices?.[0]?.message?.content?.trim();
}

/**
 * Handles chat interactions (mentions, replies)
 * @param {Message} message - The Discord message object
 * @param {Client} client - The Discord client
 */
export async function handleChat(message, client) {
    // Check if channel is ignored for chat
    const ignoredChannels = process.env.IGNORED_CHAT_CHANNELS
        ? process.env.IGNORED_CHAT_CHANNELS.split(',').map(id => id.trim())
        : [];

    if (ignoredChannels.includes(message.channel.id)) {
        return; // Ignore chat in this channel
    }

    const mentioned = message.mentions.has(client.user);
    let repliedToBot = false;

    if (message.reference?.messageId) {
        try {
            const ref = await message.channel.messages.fetch(message.reference.messageId);
            if (ref.author.id === client.user.id) repliedToBot = true;
        } catch { }
    }

    if (!mentioned && !repliedToBot) return;

    const channelKey = message.channel.id;
    if (!histories.has(channelKey)) histories.set(channelKey, []);
    lastAccess.set(channelKey, Date.now()); // Update access time
    const history = histories.get(channelKey);

    const prompt =
        message.content
            .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
            .trim() || 'Hello';

    // Check for images
    let imageUrl = null;
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            imageUrl = attachment.url;
        }
    }

    // 1) Try FAQ first (RAG)
    let faqContext = '';
    try {
        if (typeof findFaqAnswer === 'function') {
            const faqResult = await findFaqAnswer(prompt);
            if (faqResult) {
                console.log(`[RAG] Found context: ${faqResult.slice(0, 50)}...`);
                faqContext = `
 RELEVANT FAQ DOCUMENTATION:
 """
 ${faqResult}
 """
 
 INSTRUCTIONS:
 Answer the user's question primarily using the documentation above.
 If the documentation is relevant, paraphrase it to answer the question naturally.
 If the documentation is NOT relevant to the specific question, ignore it.
 `;
            }
        }
    } catch (err) {
        console.error('FAQ lookup failed:', err);
    }

    // 2) Groq chat (with RAG context + memory)
    await message.channel.sendTyping();

    // Fetch user memories + recent server events in parallel
    let memories = [];
    let recentEvents = [];
    if (client.supabase) {
        try {
            [memories, recentEvents] = await Promise.all([
                getMemories(client.supabase, message.author.id),
                getRecentServerEvents(client.supabase, client),
            ]);
        } catch (err) {
            console.error('[Chat] Memory fetch error:', err.message);
        }
    }

    // Build system prompt with user context + memories + events
    let messages = [];
    const systemPrompt = buildSystemPrompt(message.member, message.author);
    const memoryContext = formatMemoryContext(memories, recentEvents);

    // Add ambient channel context (what's been happening in the channel)
    let ambientContext = '';
    const channelBuf = getChannelBuffer(message.channel.id);
    if (channelBuf.length > 0) {
        const recent = channelBuf.slice(-10); // Last 10 messages for context
        ambientContext = '\nRECENT CHANNEL ACTIVITY (what you\'ve been observing):\n'
            + recent.map(m => `${m.author}: ${m.content}${m.hasImage ? ' [image]' : ''}`).join('\n')
            + '\n';
    }

    messages.push({ role: 'system', content: systemPrompt + memoryContext + ambientContext });
    if (faqContext) {
        messages.push({ role: 'system', content: faqContext });
    }

    // Add history (text only for context)
    for (const h of history) {
        messages.push({ role: h.role, content: h.text });
    }

    // Determine model to use
    let modelToUse = CHAT_MODEL;

    // Build the current user message
    if (imageUrl) {
        // Multi-modal format
        messages.push({
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } }
            ]
        });

        // Import config to get the vision model
        const { default: config } = await import('../config.js');
        modelToUse = config.ai.visionModel || "llama-3.2-11b-vision-preview";
        console.log(`[Chat] Using Vision Model: ${modelToUse} for image.`);
    } else {
        // Standard text format
        messages.push({ role: 'user', content: prompt });
    }

    // Call Groq
    let replyText;
    try {
        const data = await groqChatCompletion({
            model: modelToUse,
            messages,
            temperature: CHAT_TEMPERATURE,
            max_tokens: CHAT_MAX_TOKENS
        });
        replyText = data?.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't generate a reply.";
    } catch (error) {
        console.error('Chat error:', error);
        replyText = "I encountered an error while trying to think of a response.";
    }

    await message.reply(replyText);

    history.push({ role: 'user', text: prompt });
    history.push({ role: 'assistant', text: replyText });
    while (history.length > MAX_HISTORY_MESSAGES) history.shift();

    // Fire-and-forget: extract and save any notable facts from this conversation
    if (client.supabase && history.length >= 2) {
        const nameToUse = message.member?.displayName || message.author.globalName || message.author.username;
        extractAndSaveMemories(
            client.supabase,
            message.author.id,
            nameToUse,
            history
        ).catch(err => console.error('[Chat] Memory extraction failed:', err.message));
    }
}
