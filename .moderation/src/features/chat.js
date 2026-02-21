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
const SYSTEM_PROMPT = `
You are a friendly chatbot for ${COMPANY_NAME}${COMPANY_SHORT ? ` (${COMPANY_SHORT})` : ''}.
Keep replies very brief, clear, and helpful.
`;

function buildChatMessages(history, prompt) {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
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

    // 1) Try FAQ first (RAG)
    let faqContext = '';
    try {
        if (typeof findFaqAnswer === 'function') {
            const faqResult = await findFaqAnswer(prompt);
            // faqResult should be { title, content, score } or just content string depending on implementation
            // The current findFaqAnswer returns just the content string if successful
            if (faqResult) {
                // RAG: We found a relevant FAQ. We don't reply directly.
                // Instead we feed it to the AI.
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

    // Inject RAG context into system prompt or as a preceding system message
    const messages = buildChatMessages(history, prompt);
    if (faqContext) {
        // Insert RAG instructions right after the main system prompt
        messages.splice(1, 0, { role: 'system', content: faqContext });
    }

    const replyText =
        (await callGroqChat(messages)) ||
        "Sorry, I couldn't generate a reply.";

    await message.reply(replyText);

    history.push({ role: 'user', text: prompt });
    history.push({ role: 'assistant', text: replyText });
    while (history.length > MAX_HISTORY_MESSAGES) history.shift();
}
