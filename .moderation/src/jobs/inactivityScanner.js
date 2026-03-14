/**
 * inactivityScanner.js
 * Runs on bot startup and daily at 1 AM.
 *
 * Strategy to avoid opcode 8 (REQUEST_GUILD_MEMBERS) rate limits:
 * - Fetch registered players from Supabase (filtered by guild_id)
 * - Fetch each Discord member individually via REST (not gateway)
 * - Check if they have AP role, check last run, deactivate if inactive
 *
 * Rules:
 * - Only remove the AP role. DO NOT remove SMO, FO, or O roles.
 * - Prepend [RP] to their nickname: "[SMO] BonD" → "[RP] [SMO] BonD"
 * - Move entry from AP embed to RP embed.
 */
import { modifyRegistryComponents } from '../utils/embedManager.js';

const TARGET_GUILD_ID = '1448027116074434593';

const ENLISTED_ROLE_ID = '1463184412937289973';
const RP_ROLE_ID = process.env.RP_ROLE_ID || '1482059608536387795';
const INACTIVITY_DAYS = 7;

/**
 * @param {import('discord.js').Client} client
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function runInactivityScan(client, supabase) {
    console.log('[INACTIVITY] Starting inactivity scan...');
    try {
        const guild = await client.guilds.fetch(TARGET_GUILD_ID);
        if (!guild) {
            console.error('[INACTIVITY] Guild not found.');
            return;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - INACTIVITY_DAYS);

        // Step 1: Get all registered players in this guild from Supabase
        const { data: players, error: playersError } = await supabase
            .from('players')
            .select('id, discord_id, registration_number')
            .eq('guild_id', TARGET_GUILD_ID);

        if (playersError) {
            console.error('[INACTIVITY] Error fetching players:', playersError.message);
            return;
        }
        if (!players || players.length === 0) {
            console.log('[INACTIVITY] No players found in guild.');
            return;
        }

        console.log(`[INACTIVITY] Checking ${players.length} registered player(s)...`);

        const rpWebhookUrl = process.env.RP_WEBHOOK_URL;
        const rpMessageId = process.env.RP_EMBED_MESSAGE_ID;
        const enlistWebhookUrl = process.env.REGISTER_WEBHOOK_URL;
        const enlistMessageId = process.env.REGISTER_EMBED_MESSAGE_ID;

        let processed = 0;

        for (const player of players) {
            try {
                // Fetch member individually via REST (avoids opcode 8 / gateway rate limits)
                const member = await guild.members.fetch({ user: player.discord_id, force: true })
                    .catch(() => null);
                if (!member) continue;

                // Only process members who have the AP role but NOT the RP role yet
                if (!member.roles.cache.has(ENLISTED_ROLE_ID)) continue;
                if (member.roles.cache.has(RP_ROLE_ID)) continue;

                // Check their most recent run
                const { data: lastRun } = await supabase
                    .from('runs')
                    .select('created_at')
                    .eq('player_id', player.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                const isInactive = !lastRun || new Date(lastRun.created_at) < cutoffDate;
                if (!isInactive) continue;

                // --- DEACTIVATION ---

                // 1. Remove ONLY the AP role (keep SMO/FO/O roles)
                await member.roles.remove(ENLISTED_ROLE_ID);

                // 2. Add RP role
                await member.roles.add(RP_ROLE_ID);

                // 3. Prepend [RP] to nickname, preserving any existing prefix like [SMO]
                const currentNick = member.nickname || member.user.username;
                if (!currentNick.startsWith('[RP]')) {
                    const newNick = `[RP] ${currentNick}`.substring(0, 32);
                    await member.setNickname(newNick).catch(e =>
                        console.error(`[INACTIVITY] Nickname update failed for ${member.user.username}:`, e.message)
                    );
                }

                // 4. Move embed: remove from AP embed, add to RP embed
                if (enlistWebhookUrl && enlistMessageId) {
                    await modifyRegistryComponents(enlistWebhookUrl, enlistMessageId, player.discord_id, { action: 'remove' });
                }
                if (rpWebhookUrl && rpMessageId && player.registration_number) {
                    await modifyRegistryComponents(rpWebhookUrl, rpMessageId, player.discord_id, { action: 'add', registrationNumber: player.registration_number });
                }

                processed++;
                console.log(`[INACTIVITY] Moved ${member.user.username} to Reserved Personnel.`);

                // Small delay between members to stay within REST rate limits
                await new Promise(r => setTimeout(r, 1000));

            } catch (err) {
                console.error(`[INACTIVITY] Error processing player ${player.discord_id}:`, err.message);
            }
        }

        console.log(`[INACTIVITY] Scan complete. ${processed} member(s) moved to Reserved Personnel.`);
    } catch (err) {
        console.error('[INACTIVITY] Fatal scan error:', err.message);
    }
}
