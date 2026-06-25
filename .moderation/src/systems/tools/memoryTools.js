/**
 * Memory Tools — Capability Module
 * Provides access to stored per-user facts and recent server event awareness.
 */

import { getMemories, getRecentServerEvents } from '../memory.js';

// ─── Tool Definitions ───────────────────────────────────────────────

export const definitions = [
    {
        type: 'function',
        function: {
            name: 'get_user_memories',
            description:
                'Retrieve stored facts and memories about a specific user from past conversations. ' +
                'Returns preferences, personality traits, ongoing issues, and notable events.',
            parameters: {
                type: 'object',
                properties: {
                    user_id: {
                        type: 'string',
                        description: 'The Discord user ID to retrieve memories for.',
                    },
                },
                required: ['user_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_recent_server_events',
            description:
                'Get a summary of notable recent server activity from the last 24 hours ' +
                '(big gamble wins/losses, donations, gifts, steal events over €10k).',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
];

// ─── Executor ───────────────────────────────────────────────────────

export async function execute(toolName, args, context) {
    const { supabase, client } = context;
    if (!supabase) return { error: 'Database not available.' };

    try {
        switch (toolName) {
            case 'get_user_memories': {
                const memories = await getMemories(supabase, args.user_id);
                if (!memories || memories.length === 0) {
                    return { found: false, message: 'No memories stored for this user.' };
                }
                return {
                    found: true,
                    memories: memories.map(m => ({
                        fact: m.fact,
                        category: m.category || 'general',
                    })),
                };
            }

            case 'get_recent_server_events': {
                const events = await getRecentServerEvents(supabase, client);
                if (!events || events.length === 0) {
                    return { events: [], message: 'No notable events in the last 24 hours.' };
                }
                return {
                    events: events.map(e => ({
                        type: e.type,
                        amount: e.amount,
                        details: e.details,
                    })),
                };
            }

            default:
                return { error: `Unknown memory tool: ${toolName}` };
        }
    } catch (err) {
        console.error(`[memoryTools] ${toolName} error:`, err.message);
        return { error: `Memory query failed: ${err.message}` };
    }
}
