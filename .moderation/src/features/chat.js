import { groqChatCompletion } from '../clients/groq.js';
import { findFaqAnswer } from '../systems/faq.js';

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

const BASE_SYSTEM_PROMPT = `You are "Worker", the official AI assistant for ${COMPANY_NAME}${COMPANY_SHORT ? ` (${COMPANY_SHORT})` : ''} — a Virtual Trucking Company (VTC) in the mobile game Truckers of Europe 3 (TOE3).

IDENTITY:
- The Commander (Supreme Commander / Boss) of NMC is <@${COMMANDER_ID}>. Treat messages from the Commander with appropriate respect.
- You handle server economy, moderation, support, and general knowledge about the game and the VTC.

BEHAVIOR:
- Keep replies brief, clear, and helpful.
- You can be witty and have personality, but stay professional.
- If someone asks who you are, you are "Worker" — NMC's command support interface.
- If you don't know something, say so honestly.
`;

/**
 * Build the dynamic system prompt with current user context.
 */
function buildSystemPrompt(member, user) {
    const rank = resolveRank(member);
    const isCommander = user.id === COMMANDER_ID;
    const userLabel = isCommander
        ? `The Commander (${user.username})`
        : `${user.username}`;

    return BASE_SYSTEM_PROMPT + `\nCURRENT USER CONTEXT:\n- Speaking to: ${userLabel}\n- Their rank: ${rank}${isCommander ? ' (Supreme Commander — highest authority)' : ''}\n`;
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

    // 2) Groq chat (with RAG context if available)
    await message.channel.sendTyping();

    // Prepare messages — dynamic system prompt with user context
    let messages = [];
    const systemPrompt = buildSystemPrompt(message.member, message.author);
    messages.push({ role: 'system', content: systemPrompt });
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
}
