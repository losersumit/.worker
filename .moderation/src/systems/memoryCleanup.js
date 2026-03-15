import { createClient } from '@supabase/supabase-js';
import { groqChatCompletion } from '../clients/groq.js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

const CLEANUP_PROMPT = `You are a memory consolidation AI for a Discord bot named "Worker".
Below is a list of facts currently remembered about a specific user.
Your job is to identify which facts are redundant, obsolete, or completely useless, and should be FORGOTTEN to make room for new memories.

Rules:
1. Keep core personality traits, long-term preferences, and major relationships.
2. DELETE redundant facts (e.g., if there are two facts saying "likes the color blue", delete the older/less descriptive one).
3. DELETE temporary states that are no longer relevant ("is currently eating lunch", "said hello today").
4. DELETE extremely trivial details unless they contribute to a running joke.

You must reply with ONLY a JSON array containing the exact text of the facts that should be DELETED.
If ALL facts are important and nothing should be deleted, return an empty array [].
Example: ["is eating lunch right now", "likes trucks"]`;

/**
 * Runs a standalone job to clean up user memories and AI RAG data.
 */
export async function runMemoryCleanup() {
    try {
        console.log('[MEMORY_CLEANUP] Starting cleanup routine...');

        // --- AI RAG Database Pruning ---
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const cutoffString = thirtyDaysAgo.toISOString();

        console.log(`[MEMORY_CLEANUP] Pruning AI messages and chunks older than: ${cutoffString}`);

        // 1. Delete old raw messages
        const { error: msgErr } = await supabase
            .from('messages')
            .delete()
            .lt('created_at', cutoffString);

        if (msgErr) console.error('[MEMORY_CLEANUP] Error pruning messages:', msgErr);

        // 2. Delete old chunks (keep summaries forever)
        const { error: chunkErr } = await supabase
            .from('chunks')
            .delete()
            .lt('end_time', cutoffString);

        if (chunkErr) console.error('[MEMORY_CLEANUP] Error pruning chunks:', chunkErr);
        // -------------------------------

        console.log('[MEMORY_CLEANUP] AI RAG cleanup completed. Starting user memory consolidation...');

        // 1. Get all memories, grouped by user
        const { data: allMemories, error } = await supabase
            .from('bot_memories')
            .select('*')
            .order('created_at', { ascending: false });

        if (error || !allMemories) {
            console.error('[Memory Cleanup] Error fetching memories:', error?.message);
            return;
        }

        const userMemories = {};
        for (const m of allMemories) {
            if (!userMemories[m.user_id]) userMemories[m.user_id] = [];
            userMemories[m.user_id].push(m);
        }

        // 2. Evaluate users who have accumulated a decent amount of facts
        let totalDeleted = 0;
        for (const [userId, memories] of Object.entries(userMemories)) {
            // Only prune if they have a healthy ammount of memories to consolidate
            if (memories.length > 5) {
                const factListText = memories.map(m => `- ${m.fact}`).join('\n');

                try {
                    const result = await groqChatCompletion({
                        model: 'llama-3.3-70b-versatile',
                        messages: [
                            { role: 'system', content: CLEANUP_PROMPT },
                            { role: 'user', content: `Current facts for user:\n${factListText}\n\nList the exact facts to delete as a JSON array.` }
                        ],
                        max_tokens: 500,
                        temperature: 0.1,
                    });

                    const rawResponse = result?.choices?.[0]?.message?.content?.trim();
                    if (!rawResponse) continue;

                    let toDeleteTexts = [];
                    try {
                        const cleaned = rawResponse.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
                        toDeleteTexts = JSON.parse(cleaned);
                    } catch (e) {
                        console.log(`[Memory Cleanup] Failed to parse JSON for user ${userId}:`, rawResponse);
                        continue;
                    }

                    if (Array.isArray(toDeleteTexts) && toDeleteTexts.length > 0) {
                        // Find the matching UUIDs for these exact fact strings
                        const idsToDelete = memories
                            .filter(m => toDeleteTexts.includes(m.fact))
                            .map(m => m.id);

                        if (idsToDelete.length > 0) {
                            await supabase
                                .from('bot_memories')
                                .delete()
                                .in('id', idsToDelete);

                            totalDeleted += idsToDelete.length;
                            console.log(`[Memory Cleanup] Pruned ${idsToDelete.length} obsolete facts for user ${userId}.`);
                        }
                    }

                } catch (err) {
                    console.error(`[Memory Cleanup] Error evaluating user ${userId}:`, err.message);
                }

                // Small delay to avoid hammering the Groq API
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        console.log(`[Memory Cleanup] Finished. Total facts forgotten: ${totalDeleted}`);
    } catch (error) {
        console.error('[Memory Cleanup] Fatal error:', error);
    }
}
