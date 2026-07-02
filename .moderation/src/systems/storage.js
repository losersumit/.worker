/**
 * Discord AI Moderation Bot - Storage System (Supabase)
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../clients/supabase.js'; // Updated import

// Get the directory name where the script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define data storage paths (Only for counting now)
// We need to point to the root data directory, which is two levels up from src/systems
const DATA_DIR = path.join(__dirname, '../../data');
let countingState = { currentCount: 0, lastUserId: null };
const COUNTING_FILE = path.join(DATA_DIR, 'counting.json');

/**
 * Ensure the data directory exists (for counting file)
 */
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch (error) {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

/**
 * Initialize the storage system
 */
export async function initStorage(config) {
    // Ensure data dir exists for counting.json
    await ensureDataDir();
    await loadCountingState();
    await loadLevelState();
    console.log('Storage system initialized (Supabase Mode)');
}


/**
 * Add a warning to a user (Supabase)
 */
export async function addWarning(userId, reason, severity, config) {
    try {
        // 1. Insert new warning log
        const { error: insertError } = await supabase
            .from('mod_warnings')
            .insert({
                user_id: userId,
                reason: reason,
                severity: severity,
                moderator_id: 'AI'
            });

        if (insertError) {
            console.error('Error inserting warning to Supabase:', insertError);
            // Fallback: Continue without saving if DB fails, but return dummy data
        }

        // 2. Fetch all warnings for this user to determine action
        const warnings = await getUserWarnings(userId);
        const warningCount = warnings ? warnings.count : 1;

        // 3. Determine if further action should be taken
        const action = determineAction(warningCount, config);
        if (action) {
            // Ideally we would log this action to DB too if we had an 'actions' table,
            // but for now we just return it so index.js can execute it.
        }

        if (config.logging.consoleLog) {
            console.log(`Warning added for user ${userId}. Total warnings: ${warningCount}`);
        }

        return {
            userData: { count: warningCount }, // Minimal data needed for index.js
            recommendedAction: action
        };
    } catch (error) {
        console.error('Error in addWarning:', error);
        return { userData: { count: 1 }, recommendedAction: null };
    }
}

/**
 * Get user warnings (Supabase)
 */
export async function getUserWarnings(userId) {
    console.log(`[Storage] Fetching warnings for user: ${userId}`);
    try {
        const { count, data, error } = await supabase
            .from('mod_warnings')
            .select('*', { count: 'exact' })
            .eq('user_id', userId)
            .order('timestamp', { ascending: false })
            .limit(20); // Optimize: Only fetch recent warnings

        if (error) {
            console.error('[Storage] Error fetching warnings from Supabase:', error);
            return { count: 0, warnings: [], lastWarning: null, actionsTaken: [] };
        }

        console.log(`[Storage] Fetched ${count} warnings for ${userId}`);
        return {
            count: count || 0,
            warnings: data || [],
            lastWarning: data && data.length > 0 ? data[0].timestamp : null,
            actionsTaken: [] // Not stored in this simple schema yet
        };
    } catch (error) {
        console.error('[Storage] Exception in getUserWarnings:', error);
        return { count: 0, warnings: [], lastWarning: null, actionsTaken: [] };
    }
}

/**
 * Reset warnings for a user (Supabase)
 */
export async function resetWarnings(userId, config) {
    console.log(`[Storage] Resetting warnings for user: ${userId}`);
    try {
        const { error } = await supabase
            .from('mod_warnings')
            .delete()
            .eq('user_id', userId);

        if (error) throw error;

        if (config.logging.consoleLog) {
            console.log(`Warnings reset for user ${userId}`);
        }
    } catch (error) {
        console.error('[Storage] Error resetting warnings:', error);
    }
}

/**
 * Get server statistics (Supabase)
 */
export async function getServerStatistics(guildId) {
    console.log(`[Storage] Fetching server statistics for guild: ${guildId}`);
    try {
        // Total warnings count
        const { count: totalWarnings, error } = await supabase
            .from('mod_warnings')
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error('[Storage] Error fetching stats count:', error);
        }

        console.log(`[Storage] Total warnings count: ${totalWarnings}`);

        // For now, return safe default structure
        const stats = {
            totalWarnings: totalWarnings || 0,
            activeUsers: 'N/A',
            actionsTaken: {
                timeout1h: 0,
                timeout24h: 0,
                kick: 0,
                ban: 0
            }
        };

        console.log('[Storage] Returning stats object:', JSON.stringify(stats));
        return stats;

    } catch (error) {
        console.error('[Storage] Exception in getServerStatistics:', error);
        return {
            totalWarnings: 0,
            activeUsers: 0,
            actionsTaken: {
                timeout1h: 0,
                timeout24h: 0,
                kick: 0,
                ban: 0
            }
        };
    }
}

// ===== Counting State (Kept Local) =====
export async function loadCountingState() {
    try {
        const data = await fs.readFile(COUNTING_FILE, 'utf8');
        countingState = JSON.parse(data);
    } catch (error) {
        countingState = { currentCount: 0, lastUserId: null };
    }
    return countingState;
}

export async function saveCountingState(state) {
    countingState = state;
    try {
        await fs.writeFile(COUNTING_FILE, JSON.stringify(countingState, null, 2));
    } catch (err) {
        console.error('Error saving counting state:', err);
    }
}

export function getCountingState() {
    return countingState;
}

// ===== Level Scanning State (Kept Local) =====
const LEVEL_STATE_FILE = path.join(DATA_DIR, 'level_state.json');
let levelState = { lastProcessedId: '0' };

export async function loadLevelState() {
    try {
        const data = await fs.readFile(LEVEL_STATE_FILE, 'utf8');
        levelState = JSON.parse(data);
    } catch (error) {
        levelState = { lastProcessedId: '0' };
    }
    return levelState;
}

export async function saveLevelState(state) {
    levelState = state;
    try {
        await fs.writeFile(LEVEL_STATE_FILE, JSON.stringify(levelState, null, 2));
    } catch (err) {
        console.error('Error saving level state:', err);
    }
}

export function getLevelState() {
    return levelState;
}

// Removed: forceSave, getAllWarnings (not efficient for DB)

export async function isUserKilled(userId) {
    try {
        const { data, error } = await supabase
            .from('killed_users')
            .select('status')
            .eq('discord_id', userId)
            .maybeSingle();
        if (error) {
            console.error('Error fetching killed status:', error);
            return false;
        }
        return data?.status === 'killed';
    } catch (err) {
        console.error('isUserKilled error:', err);
        return false;
    }
}

export async function killUser(userId, username = '') {
    try {
        const { error } = await supabase
            .from('killed_users')
            .upsert({
                discord_id: userId,
                username: username,
                status: 'killed',
                updated_at: new Date().toISOString()
            }, { onConflict: 'discord_id' });
        if (error) {
            console.error('Error setting user status to killed:', error);
        }
    } catch (err) {
        console.error('killUser error:', err);
    }
}

export async function unkillUser(userId) {
    try {
        const { error } = await supabase
            .from('killed_users')
            .update({
                status: 'alive',
                updated_at: new Date().toISOString()
            })
            .eq('discord_id', userId);
        if (error) {
            console.error('Error setting user status to alive:', error);
        }
    } catch (err) {
        console.error('unkillUser error:', err);
    }
}

/**
 * Determine what action to take based on warning count
 */
function determineAction(warningCount, config) {
    const thresholds = config.warnings.actionThresholds;

    if (warningCount >= thresholds.ban) {
        return 'ban';
    } else if (warningCount >= thresholds.kick) {
        return 'kick';
    } else if (warningCount >= thresholds.timeout24h) {
        return 'timeout_24h';
    } else if (warningCount >= thresholds.timeout1h) {
        return 'timeout_1h';
    }

    return null;
}

