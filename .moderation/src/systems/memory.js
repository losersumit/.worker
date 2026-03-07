/**
 * Bot Memory System
 * Stores and retrieves per-user facts, and provides recent server event awareness.
 */

import { groqChatCompletion } from '../clients/groq.js';

const MAX_MEMORIES_PER_USER = 20;

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
        const { data, error } = await supabase
            .from('bot_memories')
            .select('fact, category')
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
        const { error } = await supabase
            .from('bot_memories')
            .insert({ user_id: userId, fact, category });

        if (error) {
            console.error('[Memory] Save error:', error.message);
            return;
        }

        // Prune if over limit — delete oldest entries
        const { data: all } = await supabase
            .from('bot_memories')
            .select('id')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (all && all.length > MAX_MEMORIES_PER_USER) {
            const toDelete = all.slice(0, all.length - MAX_MEMORIES_PER_USER);
            await supabase
                .from('bot_memories')
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

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a conversation between a user and "Worker" (an AI bot), extract 0-3 SHORT notable facts about the user that would be worth remembering for future conversations.

Good facts to extract:
- Preferences 
- Personality ("sarcastic humor", "very competitive", "friendly")  
- Notable events
- Skills
- Relationships

Rules:
- Each fact must be under 15 words
- Do NOT extract greetings, small talk, generic questions, or FAQ lookups
- Do NOT extract facts about Worker, only about the USER
- Return a JSON array: ["fact1", "fact2"] or the word NONE if nothing notable`;

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
                { role: 'user', content: `Extract facts about "${username}" from this conversation:\n\n${convoText}` }
            ],
            max_tokens: 200,
            temperature: 0.2,
        });

        const raw = result?.choices?.[0]?.message?.content?.trim();
        if (!raw || raw.toUpperCase() === 'NONE') return;

        // Parse JSON — handle markdown code blocks the LLM might wrap it in
        let facts;
        try {
            const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
            facts = JSON.parse(cleaned);
        } catch {
            console.log('[Memory] Could not parse extraction:', raw);
            return;
        }

        if (!Array.isArray(facts) || facts.length === 0) return;

        // Deduplicate against existing memories
        const existing = await getMemories(supabase, userId);
        const existingLower = existing.map(m => m.fact.toLowerCase());

        for (const fact of facts.slice(0, 3)) {
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
            .gt('amount', 10000) // Only notable events (>$10k)
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
        ctx += events.map(e => `- ${e.details} ($${(e.amount || 0).toLocaleString()})`).join('\n');
        ctx += '\nYou can reference these events if they come up in conversation.\n';
    }

    return ctx;
}
