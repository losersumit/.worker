/**
 * Bot Memory System
 * Stores and retrieves per-user facts, and provides recent server event awareness.
 */

import { groqChatCompletion } from '../clients/groq.js';

const MAX_MEMORIES_PER_USER = 20;


const MEMORY_TABLE_CANDIDATES = ['bot_memories', 'memories', 'user_memories'];
let resolvedMemoryTable = null;
let warnedMissingMemoryTable = false;

function isMissingTableError(error) {
    return error?.code === 'PGRST205' || /Could not find the table/i.test(error?.message || '');
}

export async function getMemoryTableName(supabase) {
    if (resolvedMemoryTable) {
        return resolvedMemoryTable;
    }

    for (const tableName of MEMORY_TABLE_CANDIDATES) {
        const { error } = await supabase
            .from(tableName)
            .select('id', { head: true, count: 'exact' })
            .limit(1);

        if (!error) {
            resolvedMemoryTable = tableName;
            return resolvedMemoryTable;
        }

        if (!isMissingTableError(error)) {
            console.error(`[Memory] Could not verify table ${tableName}:`, error.message);
        }
    }

    if (!warnedMissingMemoryTable) {
        console.warn(`[Memory] No supported memory table was found. Tried: ${MEMORY_TABLE_CANDIDATES.join(', ')}`);
        warnedMissingMemoryTable = true;
    }

    return null;
}


// ========================================================================
// CORE MEMORY OPERATIONS
// ========================================================================

/**
 * Fetch all stored facts/memories about a specific user.
 * @param {SupabaseClient} supabase
 * @param {string} userId - Discord user ID
 * @returns {Promise<Array<{fact: string, category: string}>>}
 */
export async function getMemories(supabase, userId) {
    try {
        const memoryTable = await getMemoryTableName(supabase);
        if (!memoryTable) return [];

        const { data, error } = await supabase
            .from(memoryTable)
            .select('id, fact, category')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(MAX_MEMORIES_PER_USER);

        if (error) {
            console.error('[Memory] Fetch error:', error.message);
            return [];
        }
        return data || [];
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
        const memoryTable = await getMemoryTableName(supabase);
        if (!memoryTable) return;

        const { error } = await supabase
            .from(memoryTable)
            .insert({ user_id: userId, fact, category });

        if (error) {
            console.error('[Memory] Save error:', error.message);
            return;
        }

        // Prune if over limit — delete oldest entries
        const { data: all } = await supabase
            .from(memoryTable)
            .select('id')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (all && all.length > MAX_MEMORIES_PER_USER) {
            const toDelete = all.slice(0, all.length - MAX_MEMORIES_PER_USER);
            await supabase
                .from(memoryTable)
                .delete()
                .in('id', toDelete.map(r => r.id));
            console.log(`[Memory] Pruned ${toDelete.length} old facts for ${userId}`);
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
        // Need at least 2 messages (1 user + 1 assistant) to have a meaningful conversation
        if (!conversationHistory || conversationHistory.length < 2) return;

        // Fetch existing memories to provide to the LLM
        const existing = await getMemories(supabase, userId);
        const existingContext = existing.length > 0
            ? 'CURRENT MEMORIES:\n' + existing.map(m => `[ID: ${m.id}] ${m.fact}`).join('\n')
            : 'CURRENT MEMORIES: None.';

        // Build conversation text
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
            response_format: { type: "json_object" }
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

        // Handle Reletions
        if (toDeleteIds.length > 0) {
            const memoryTable = await getMemoryTableName(supabase);
            if (!memoryTable) return;

            const { error: delError } = await supabase
                .from(memoryTable)
                .delete()
                .eq('user_id', userId)
                .in('id', toDeleteIds);

            if (!delError) {
                console.log(`[Memory] 🗑️ Deleted obsolete facts for ${username}: [${toDeleteIds.join(', ')}]`);
            } else {
                console.error('[Memory] Delete error:', delError.message);
            }
        }

        if (toAdd.length === 0) return;

        // Fetch refreshed memories (in case some were just deleted) to check for duplicates before adding
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

// Cache to avoid querying every single chat message
let eventsCache = { data: [], fetchedAt: 0 };
const EVENTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get recent notable economy events from the last 24 hours.
 * Results are cached for 5 minutes to avoid spam queries.
 * @param {SupabaseClient} supabase
 * @param {Client} [client] - Optional discord client to resolve usernames
 * @returns {Promise<Array<{type: string, amount: number, details: string}>>}
 */
export async function getRecentServerEvents(supabase, client) {
    try {
        // Return cache if fresh
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
            .gt('amount', 10000) // Only notable events (>€10k)
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
