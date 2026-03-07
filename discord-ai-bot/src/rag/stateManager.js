import { supabase } from '../db/db.js';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 8;

export async function checkRateLimit(userId) {
    // First get or create user record
    let { data: userState, error } = await supabase
        .from('bot_state')
        .select('rate_limit_timestamps')
        .eq('user_id', userId)
        .single();

    if (error && error.code === 'PGRST116') {
        // Record does not exist, insert it
        const { data: newUserState, error: insertError } = await supabase
            .from('bot_state')
            .insert({ user_id: userId, rate_limit_timestamps: [], conversation_history: [] })
            .select('rate_limit_timestamps')
            .single();

        if (insertError) {
            console.error('State Insert Error:', insertError);
            return false; // Fail open
        }
        userState = newUserState;
    } else if (error) {
        console.error('State Select Error:', error);
        return false;
    }

    const now = Date.now();
    let timestamps = userState?.rate_limit_timestamps || [];

    // Filter out outdated timestamps
    timestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (timestamps.length >= RATE_LIMIT_MAX) {
        return true; // RATE LIMITED
    }

    // Add new timestamp and update DB
    timestamps.push(now);

    await supabase
        .from('bot_state')
        .update({ rate_limit_timestamps: timestamps, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

    return false;
}

export async function getConversationHistory(userId) {
    const { data, error } = await supabase
        .from('bot_state')
        .select('conversation_history')
        .eq('user_id', userId)
        .single();

    if (error) return [];
    return data?.conversation_history || [];
}

export async function appendConversationHistory(userId, userMessage, aiReply) {
    const history = await getConversationHistory(userId);

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: aiReply });

    // Keep only last 10 turns (20 messages)
    const trimmedHistory = history.slice(-20);

    await supabase
        .from('bot_state')
        .update({
            conversation_history: trimmedHistory,
            updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
}
