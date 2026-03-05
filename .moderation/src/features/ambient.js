/**
 * Ambient Chat System
 * Gives Worker human-like awareness by passively observing channel conversations
 * and occasionally chiming in unprompted.
 */

import { groqChatCompletion } from '../clients/groq.js';
import { getMemories, getRecentServerEvents, formatMemoryContext } from '../systems/memory.js';

// ========================================================================
// CONFIGURATION
// ========================================================================

const BUFFER_SIZE = 25;                          // Messages to remember per channel
const BURST_THRESHOLD = 4;                       // Min messages in window to consider a "burst"
const BURST_WINDOW = 45_000;                     // 45 seconds — burst detection window
const UNPROMPTED_COOLDOWN = 0;                    // No cooldown — bot can chime in freely
const RANDOM_CHANCE = 1.0;                        // 100% chance per qualifying burst
const IMAGE_CHANCE = 1.0;                        // 100% chance to react to images
const UNANSWERED_DELAY = 2 * 60 * 1000;         // 2 min — bot helps if question goes unanswered
const BUFFER_CLEANUP_INTERVAL = 10 * 60 * 1000;  // Clean stale buffers every 10 min
const BUFFER_TTL = 30 * 60 * 1000;               // Buffers expire after 30 min of inactivity

// Channels to never send unprompted messages in
const IGNORED_CHANNEL_IDS = (process.env.IGNORED_CHAT_CHANNELS || '')
    .split(',').map(id => id.trim()).filter(Boolean);

// ========================================================================
// STATE
// ========================================================================

// Per-channel message buffer: channelId -> { messages: [...], lastActivity, lastUnprompted }
const channelBuffers = new Map();

// Pending unanswered question timers: channelId -> timeoutId
const unansweredTimers = new Map();

// Cleanup stale buffers periodically
setInterval(() => {
    const now = Date.now();
    for (const [channelId, buf] of channelBuffers.entries()) {
        if (now - buf.lastActivity > BUFFER_TTL) {
            channelBuffers.delete(channelId);
            const timer = unansweredTimers.get(channelId);
            if (timer) { clearTimeout(timer); unansweredTimers.delete(channelId); }
        }
    }
}, BUFFER_CLEANUP_INTERVAL);

// ========================================================================
// AMBIENT PROMPT
// ========================================================================

const AMBIENT_SYSTEM_PROMPT = `You are "Worker", a member of the NMC (National Mobility Command) Discord server — a trucking VTC for Truckers of Europe 3.

You are passively watching a conversation. You are NOT being spoken to directly.

DECISION — should you say something?

CHIME IN when:
- Someone shares a screenshot or delivery photo → hype them up quick
- A question goes unanswered → drop a quick answer
- Something funny or notable happens → react naturally
- Someone hits a milestone → quick shoutout
- You can add something genuinely relevant in a few words

STAY QUIET when:
- People are vibing in their own convo — don't butt in
- You'd just be repeating someone
- Your comment would feel forced or out of place
- Serious/private discussion

STYLE — THIS IS CRITICAL:
- MAX 1 short sentence. Think texts, not essays. Like "lmaooo W delivery" or "nah bro that's crazy" or "gg"
- Talk like a real person in a Discord server — use slang, abbreviations, lowercase
- Examples of good replies: "sheesh", "bro what 💀", "nah fr", "W", "lol nice", "ayo??"
- NEVER write more than one sentence. NEVER write a paragraph.
- NEVER say "As an AI" or "I noticed" or anything robotic
- NEVER use asterisks (*waves*, *laughs*)
- Use emoji sparingly — one max, and only when it fits

If you should NOT speak, respond with exactly: SILENT
If you SHOULD speak, respond with ONLY your short message — nothing else.`;

// ========================================================================
// CORE: BUFFER A MESSAGE
// ========================================================================

/**
 * Buffer a message for ambient awareness. Called on EVERY non-bot message.
 * @param {Message} message - Discord message
 * @param {Client} client - Discord client
 */
export function bufferMessage(message, client) {
    // Skip ignored channels, DMs, and bot messages
    if (!message.guild) return;
    if (message.author.bot) return;
    if (IGNORED_CHANNEL_IDS.includes(message.channel.id)) return;

    const channelId = message.channel.id;

    if (!channelBuffers.has(channelId)) {
        channelBuffers.set(channelId, {
            messages: [],
            lastActivity: Date.now(),
            lastUnprompted: 0,
        });
    }

    const buf = channelBuffers.get(channelId);
    buf.lastActivity = Date.now();

    // Add message to buffer
    buf.messages.push({
        author: message.member?.displayName || message.author.globalName || message.author.username,
        authorId: message.author.id,
        content: message.content,
        hasImage: message.attachments.some(a => a.contentType?.startsWith('image/')),
        hasQuestion: /\?/.test(message.content) && message.content.length > 10,
        timestamp: Date.now(),
    });

    // Trim buffer to max size
    while (buf.messages.length > BUFFER_SIZE) buf.messages.shift();
}

// ========================================================================
// CORE: CHECK FOR UNPROMPTED RESPONSE
// ========================================================================

/**
 * Evaluate whether the bot should send an unprompted message.
 * Called after buffering each message.
 * @param {Message} message - The latest Discord message (for sending context)
 * @param {Client} client - Discord client
 */
export async function checkForUnprompted(message, client) {
    if (!message.guild || message.author.bot) return;
    if (IGNORED_CHANNEL_IDS.includes(message.channel.id)) return;

    const channelId = message.channel.id;
    const buf = channelBuffers.get(channelId);
    if (!buf || buf.messages.length < 1) return;

    const now = Date.now();

    // Cooldown check — don't spam
    if (now - buf.lastUnprompted < UNPROMPTED_COOLDOWN) return;

    const lastMsg = buf.messages[buf.messages.length - 1];

    // --- Trigger 1: Unanswered question ---
    if (lastMsg.hasQuestion) {
        console.log(`[Ambient] ❓ Question detected from ${lastMsg.author} in #${message.channel.name}. Timer set for ${UNANSWERED_DELAY / 1000}s.`);

        // Clear any existing timer and set a new one
        const existingTimer = unansweredTimers.get(channelId);
        if (existingTimer) clearTimeout(existingTimer);

        const questionTimestamp = lastMsg.timestamp;
        const questionAuthorId = lastMsg.authorId;

        const timer = setTimeout(async () => {
            unansweredTimers.delete(channelId);
            const currentBuf = channelBuffers.get(channelId);
            if (!currentBuf) return;

            // Use fresh time, not the stale `now`
            const freshNow = Date.now();
            if (freshNow - currentBuf.lastUnprompted < UNPROMPTED_COOLDOWN) return;

            const lastCurrent = currentBuf.messages[currentBuf.messages.length - 1];
            // If the last message is still the same question (nobody replied), help
            if (lastCurrent && lastCurrent.authorId === questionAuthorId && lastCurrent.timestamp === questionTimestamp) {
                console.log(`[Ambient] ❓ No reply after ${UNANSWERED_DELAY / 1000}s — bot stepping in.`);
                await sendUnprompted(message.channel, client, currentBuf, 'Someone asked a question and nobody replied. Help them out naturally.');
            }
        }, UNANSWERED_DELAY);
        unansweredTimers.set(channelId, timer);
    }

    // --- Trigger 2: Image shared (25% chance) ---
    if (lastMsg.hasImage) {
        const roll = Math.random();
        console.log(`[Ambient] 🖼️ Image detected from ${lastMsg.author}. Roll: ${roll.toFixed(3)} (need < ${IMAGE_CHANCE})`);
        if (roll < IMAGE_CHANCE) {
            await sendUnprompted(message.channel, client, buf, 'Someone just shared an image/screenshot. React to it briefly and naturally.');
            return;
        }
    }

    // --- Trigger 3: Active burst (3% random chance) ---
    const recentMessages = buf.messages.filter(m => now - m.timestamp < BURST_WINDOW);
    if (recentMessages.length >= BURST_THRESHOLD) {
        const roll = Math.random();
        console.log(`[Ambient] 💬 Burst detected: ${recentMessages.length} msgs in ${BURST_WINDOW / 1000}s. Roll: ${roll.toFixed(3)} (need < ${RANDOM_CHANCE})`);
        if (roll < RANDOM_CHANCE) {
            await sendUnprompted(message.channel, client, buf);
            return;
        }
    }
}

// ========================================================================
// SEND UNPROMPTED MESSAGE
// ========================================================================

/**
 * Build context and ask the LLM if it should speak. If yes, send the message.
 */
async function sendUnprompted(channel, client, buf, extraInstruction = '') {
    try {
        const now = Date.now();

        // Double-check cooldown (async race safety)
        if (now - buf.lastUnprompted < UNPROMPTED_COOLDOWN) return;

        // Build conversation context from buffer
        const convoText = buf.messages
            .map(m => {
                let line = `${m.author}: ${m.content}`;
                if (m.hasImage) line += ' [shared an image]';
                return line;
            })
            .join('\n');

        // Fetch memories for recent speakers
        let memoryContext = '';
        if (client.supabase) {
            try {
                // Get memories for the last person who spoke
                const lastSpeaker = buf.messages[buf.messages.length - 1];
                const [memories, events] = await Promise.all([
                    getMemories(client.supabase, lastSpeaker.authorId),
                    getRecentServerEvents(client.supabase, client),
                ]);
                memoryContext = formatMemoryContext(memories, events);
            } catch { /* non-critical */ }
        }

        const systemContent = AMBIENT_SYSTEM_PROMPT
            + memoryContext
            + (extraInstruction ? `\n\nSPECIAL CONTEXT: ${extraInstruction}` : '');

        // Ask the LLM
        const result = await groqChatCompletion({
            model: process.env.CHAT_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct',
            messages: [
                { role: 'system', content: systemContent },
                { role: 'user', content: `Here is the recent conversation in the channel:\n\n${convoText}\n\nShould you say something?` }
            ],
            temperature: 0.85,
            max_tokens: 50,
        });

        const reply = result?.choices?.[0]?.message?.content?.trim();

        // If SILENT or empty, don't send
        if (!reply || reply.toUpperCase() === 'SILENT' || reply.toUpperCase().startsWith('SILENT')) {
            return;
        }

        // Send the message!
        await channel.send(reply);
        buf.lastUnprompted = Date.now();
        console.log(`[Ambient] 💬 Unprompted in #${channel.name}: "${reply.slice(0, 80)}..."`);

    } catch (err) {
        console.error('[Ambient] Error:', err.message);
    }
}

/**
 * Get the ambient buffer for a channel (used by chat.js for context awareness).
 * @param {string} channelId
 * @returns {Array} Array of buffered messages, or empty array
 */
export function getChannelBuffer(channelId) {
    return channelBuffers.get(channelId)?.messages || [];
}
