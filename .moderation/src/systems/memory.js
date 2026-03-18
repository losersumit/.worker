/**
 * Bot Memory System
 * Stores and retrieves per-user facts, and provides recent server event awareness.
 */

import { groqChatCompletion } from '../clients/groq.js';

const MAX_MEMORIES_PER_USER = 20;

function normalizeStoredMemories(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry, index) => {
            if (typeof entry === 'string') {
                return {
                    id: index + 1,
                    fact: entry,
                    category: 'general',
                    created_at: null
                };
            }

            if (entry && typeof entry.fact === 'string') {
                return {
                    id: Number.isInteger(entry.id) ? entry.id : index + 1,
                    fact: entry.fact,
                    category: typeof entry.category === 'string' ? entry.category : 'general',
                    created_at: entry.created_at || null
                };
            }

            return null;
        })
        .filter(Boolean);
}

async function getBotStateRecord(supabase, userId) {
    const { data, error } = await supabase
        .from('bot_state')
        .select('id, user_id, conversation_history, rate_limit_timestamps')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

async function saveBotStateMemories(supabase, userId, memories, existingState = null) {
    const payload = {
        user_id: userId,
        conversation_history: memories,
        rate_limit_timestamps: existingState?.rate_limit_timestamps || [],
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('bot_state')
        .upsert(payload, { onConflict: 'user_id' });

    if (error) {
        throw error;
    }
}

function nextMemoryId(memories) {
    const maxId = memories.reduce((highest, memory) => Math.max(highest, Number.isInteger(memory.id) ? memory.id : 0), 0);
    return maxId + 1;
}

// ========================================================================
// CORE MEMORY OPERATIONS
// ========================================================================

/**
 * Fetch all stored facts/memories about a specific user.
 * @param {SupabaseClient} supabase
 * @param {string} userId - Discord user ID
 * @returns {Promise<Array<{id: number, fact: string, category: string, created_at: string | null}>>}
 */
export async function getMemories(supabase, userId) {
    try {
        const state = await getBotStateRecord(supabase, userId);
        return normalizeStoredMemories(state?.conversation_history).slice(-MAX_MEMORIES_PER_USER).reverse();
    } catch (err) {
        console.error('[Memory] Fetch exception:', err.message);
        return [];
    }
}

/**
 * Save a single fact about a user. Prunes oldest facts if limit exceeded.
 * @param {SupabaseClient} supabase
 * @param {string} userId - Discord user ID
 * @param {string} fact - The fact to store
 * @param {string} category - One of: general, economy, preference, personality
 */
export async function saveMemory(supabase, userId, fact, category = 'general') {
    try {
        const state = await getBotStateRecord(supabase, userId);
        const memories = normalizeStoredMemories(state?.conversation_history);
        memories.push({
            id: nextMemoryId(memories),
            fact,
            category,
            created_at: new Date().toISOString()
        });

        const trimmedMemories = memories.slice(-MAX_MEMORIES_PER_USER);
        await saveBotStateMemories(supabase, userId, trimmedMemories, state);

        if (memories.length > MAX_MEMORIES_PER_USER) {
            console.log(`[Memory] Pruned ${memories.length - trimmedMemories.length} old facts for ${userId}`);
        }
    } catch (err) {
        console.error('[Memory] Save exception:', err.message);
    }
}

// ========================================================================
// FACT EXTRACTION (runs after conversations)
// ========================================================================

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a conversation between a user and "Worker" (an AI bot), and the user's CURRENT MEMORIES, extract notable facts about the user that would be worth remembering for future conversations, and identify any obsolete or superseded facts that should be deleted.

Good facts to extract:
- Preferences 
- Personality ("sarcastic humor", "very competitive", "friendly")  
- Notable events / Ongoing issues
- Skills
- Relationships / Status

When to delete a fact:
- An issue has been resolved (e.g., if a memory says "User is having radio issues" and the conversation says it's fixed).
- A preference has changed.

Rules:
- Each fact must be under 15 words
- Do NOT extract greetings, small talk, generic questions, or FAQ lookups
- Do NOT extract facts about Worker, only about the USER
- You MUST return a valid JSON object with an "add" array (strings of new facts) and a "delete" array (integers of the IDs of old facts to delete).
- Example: { "add": ["Likes to play racing games", "Fixed radio issue"], "delete": [142] }
- If there is nothing to add or delete, return: { "add": [], "delete": [] }`;

/**
 * Extract notable facts from a conversation and save them.
 * This is designed to be called fire-and-forget (don't await in the main flow).
 * @param {SupabaseClient} supabase
 * @param {string} userId - Discord user ID
 * @param {string} username - Display name for the prompt
 * @param {Array} conversationHistory - Array of {role, name?, text} objects
 */
export async function extractAndSaveMemories(supabase, userId, username, conversationHistory) {
    try {
        if (!conversationHistory || conversationHistory.length < 2) return;

        const existing = await getMemories(supabase, userId);
        const existingContext = existing.length > 0
            ? 'CURRENT MEMORIES:\n' + existing.map(m => `[ID: ${m.id}] ${m.fact}`).join('\n')
            : 'CURRENT MEMORIES: None.';

        const convoText = conversationHistory
            .map(m => {
                const speaker = m.name || (m.role === 'assistant' ? 'Worker' : username);
                return `${speaker}: ${m.text || ''}`;
            })
            .join('\n');

        const result = await groqChatCompletion({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: EXTRACTION_PROMPT },
                { role: 'user', content: `${existingContext}\n\nCONVERSATION:\n${convoText}` }
            ],
            max_tokens: 250,
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const raw = result?.choices?.[0]?.message?.content?.trim();
        if (!raw) return;

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            console.log('[Memory] Could not parse extraction:', raw);
            return;
        }

        const toAdd = Array.isArray(parsed.add) ? parsed.add : [];
        const toDeleteIds = Array.isArray(parsed.delete) ? parsed.delete.filter(id => Number.isInteger(id)) : [];

        if (toDeleteIds.length > 0) {
            const state = await getBotStateRecord(supabase, userId);
            const existingMemories = normalizeStoredMemories(state?.conversation_history);
            const filteredMemories = existingMemories.filter(memory => !toDeleteIds.includes(memory.id));

            await saveBotStateMemories(supabase, userId, filteredMemories, state);
            console.log(`[Memory] 🗑️ Deleted obsolete facts for ${username}: [${toDeleteIds.join(', ')}]`);
        }

        if (toAdd.length === 0) return;

        const refreshedExisting = await getMemories(supabase, userId);
        const existingLower = refreshedExisting.map(m => m.fact.toLowerCase());

        for (const fact of toAdd.slice(0, 3)) {
            if (typeof fact !== 'string' || fact.length < 5) continue;

            const factLower = fact.toLowerCase();
            const isDuplicate = existingLower.some(e =>
                e.includes(factLower) || factLower.includes(e)
            );

            if (!isDuplicate) {
                await saveMemory(supabase, userId, fact);
                console.log(`[Memory] 💾 Saved: "${fact}" for ${username}`);
            }
        }
    } catch (err) {
        console.error('[Memory] Extraction error:', err.message);
    }
}

// ========================================================================
// RECENT SERVER EVENTS (Tier 1 awareness)
// ========================================================================

let eventsCache = { data: [], fetchedAt: 0 };
const EVENTS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get recent notable economy events from the last 24 hours.
 * Results are cached for 5 minutes to avoid spam queries.
 * @param {SupabaseClient} supabase
 * @param {Client} [client] - Optional discord client to resolve usernames
 * @returns {Promise<Array<{type: string, amount: number, details: string}>>}
 */
export async function getRecentServerEvents(supabase, client) {
    try {
        if (Date.now() - eventsCache.fetchedAt < EVENTS_CACHE_TTL) {
            return eventsCache.data;
        }

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('player_economy_history')
            .select(`
                transaction_type, 
                amount, 
                details,
                players!inner(discord_id)
            `)
            .gte('created_at', since)
            .in('transaction_type', ['gamble_win', 'gamble_loss', 'steal_success', 'donate', 'gift'])
            .gt('amount', 10000)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('[Memory] Events query error:', error.message);
            return [];
        }

        const events = await Promise.all((data || []).map(async e => {
            let playerName = 'Someone';
            const discordId = e.players?.discord_id;

            if (discordId && client) {
                try {
                    const user = await client.users.fetch(discordId);
                    playerName = user.globalName || user.username;
                } catch {
                    playerName = `<@${discordId}>`;
                }
            } else if (discordId) {
                playerName = `<@${discordId}>`;
            }

            return {
                type: e.transaction_type,
                amount: e.amount,
                details: `${playerName}: ${e.details}`,
            };
        }));

        eventsCache = { data: events, fetchedAt: Date.now() };
        return events;
    } catch (err) {
        console.error('[Memory] Events exception:', err.message);
        return [];
    }
}

// ========================================================================
// CONTEXT FORMATTING
// ========================================================================

/**
 * Format memories and events into a context string for the system prompt.
 * @param {Array} memories - Array of {fact, category}
 * @param {Array} events - Array of {type, amount, details}
 * @returns {string} Formatted context block, or empty string if nothing to add.
 */
export function formatMemoryContext(memories, events) {
    let ctx = '';

    if (memories.length > 0) {
        ctx += '\nWHAT YOU REMEMBER ABOUT THIS USER:\n';
        ctx += memories.map(m => `- ${m.fact}`).join('\n');
        ctx += '\nUse these memories naturally — reference them when relevant, but don\'t force them into every reply.\n';
    }

    if (events.length > 0) {
        ctx += '\nRECENT SERVER ACTIVITY (last 24h):\n';
        ctx += events.map(e => `- ${e.details} (€${(e.amount || 0).toLocaleString()})`).join('\n');
        ctx += '\nYou can reference these events if they come up in conversation.\n';
    }

    return ctx;
}
