/**
 * inactivityScanner.js
 * Runs on bot startup and daily at 1 AM.
 *
 * Rules:
 * - Fetch all users with ENLISTED_TAG_ROLE_ID
 * - If last run > 7 days ago OR (0 runs AND join date > 7 days ago): Move to RP
 * - Keep existing Officer roles intact. Add/remove AP/RP roles accordingly.
 * - Prepend [RP] to nickname if moving to RP.
 * - Rebuild AP and RP embeds fully sorted by rank (SMO > FO > O > Member).
 */

import { WebhookClient } from 'discord.js';

const TARGET_GUILD_ID = process.env.GUILD_ID || '1448027116074434593';

// Roles
const ENLISTED_TAG_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1482386008376086598';
const AP_ROLE_ID = process.env.AP_ROLE_ID || '1463184412937289973';
const RP_ROLE_ID = process.env.RP_ROLE_ID || '1482059608536387795';

const SMO_ROLE_ID = process.env.SMO_ROLE_ID || '1475314856184778835';
const FO_ROLE_ID = process.env.FO_ROLE_ID || '1475314865878077603';
const O_ROLE_ID = process.env.O_ROLE_ID || '1475314870802055421';

const INACTIVITY_DAYS = 7;

/**
 * @param {import('discord.js').Client} client
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function runInactivityScan(client, supabase) {
    console.log('[INACTIVITY] Starting global inactivity scan and embed rebuild...');
    try {
        const guild = await client.guilds.fetch(TARGET_GUILD_ID);
        if (!guild) {
            console.error('[INACTIVITY] Guild not found.');
            return;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - INACTIVITY_DAYS);

        // 1. Fetch all enlisted drivers from Supabase to avoid Discord opcode 8 rate limit
        const { data: globalEnlisted } = await supabase
            .from('enlisted_drivers')
            .select('discord_id, created_at, unit_number');

        if (!globalEnlisted || globalEnlisted.length === 0) {
            console.log('[INACTIVITY] No enlisted drivers found in database.');
            return;
        }

        console.log(`[INACTIVITY] Found ${globalEnlisted.length} total enlisted members in DB. Starting individual checks...`);

        const apMembers = [];
        const rpMembers = [];

        for (const driver of globalEnlisted) {
            try {
                const memberId = driver.discord_id;
                // Fetch member individually via REST to avoid gateway rate limits
                const member = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);
                
                if (!member) continue; // Left the server
                if (!member.roles.cache.has(ENLISTED_TAG_ROLE_ID)) continue; // Lost the enlisted role

                // Fetch player info to get player_id and registration_number
                const { data: player } = await supabase
                    .from('players')
                    .select('id, registration_number')
                    .eq('discord_id', memberId)
                    .maybeSingle();

                let isInactive = false;
                let enlistDate = new Date(driver.created_at);
                
                // Fix for grandfathered users added during sync: If enlist date is very recent but they joined the server long ago, use server join date.
                const oneDayAgo = new Date();
                oneDayAgo.setDate(oneDayAgo.getDate() - 1);
                if (enlistDate > oneDayAgo && member.joinedAt && member.joinedAt < oneDayAgo) {
                    enlistDate = member.joinedAt;
                }

                const regNumber = player?.registration_number || driver.unit_number || '???';

                if (player) {
                    // Check their most recent run
                    const { data: lastRun } = await supabase
                        .from('runs')
                        .select('created_at')
                        .eq('player_id', player.id)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!lastRun) {
                        // 0 runs. Check join date against grace period
                        if (enlistDate < cutoffDate) {
                            isInactive = true; // Joined > 7 days ago and 0 runs
                        }
                    } else {
                        // Has runs. Check if last run is older than 7 days
                        if (new Date(lastRun.created_at) < cutoffDate) {
                            isInactive = true;
                        }
                    }
                } else {
                    // Not in players table. Fallback to check enlist date only
                    if (enlistDate < cutoffDate) {
                        isInactive = true;
                    }
                }

                // --- ROLE & DB UPDATES ---
                if (isInactive) {
                    // Moving to / Staying in RP
                    if (member.roles.cache.has(AP_ROLE_ID)) await member.roles.remove(AP_ROLE_ID);
                    if (!member.roles.cache.has(RP_ROLE_ID)) await member.roles.add(RP_ROLE_ID);

                    // Update Nickname
                    const currentNick = member.nickname || member.user.username;
                    if (!currentNick.startsWith('[RP]')) {
                        const newNick = `[RP] ${currentNick}`.substring(0, 32);
                        await member.setNickname(newNick).catch(() => {});
                    }

                    // Update DB
                    await supabase.from('enlisted_drivers').update({ status: 'RP' }).eq('discord_id', memberId);
                    
                    rpMembers.push({ member, regNumber });
                } else {
                    // Moving to / Staying in AP
                    if (member.roles.cache.has(RP_ROLE_ID)) await member.roles.remove(RP_ROLE_ID);
                    if (!member.roles.cache.has(AP_ROLE_ID)) await member.roles.add(AP_ROLE_ID);

                    // Remove [RP] from nickname if it exists
                    const currentNick = member.nickname || member.user.username;
                    if (currentNick.startsWith('[RP] ')) {
                        const newNick = currentNick.replace('[RP] ', '').substring(0, 32);
                        await member.setNickname(newNick).catch(() => {});
                    }

                    // Update DB
                    await supabase.from('enlisted_drivers').update({ status: 'AP' }).eq('discord_id', memberId);

                    apMembers.push({ member, regNumber });
                }

                // Small delay between members to stay within REST rate limits
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                console.error(`[INACTIVITY] Error processing member ${driver.discord_id}:`, err.message);
            }
        }

        // --- SORTING LOGIC ---
        // SMO (1475314856184778835) > FO (1475314865878077603) > O (1475314870802055421) > Member
        const getRankWeight = (member) => {
            if (member.roles.cache.has(SMO_ROLE_ID)) return 4;
            if (member.roles.cache.has(FO_ROLE_ID)) return 3;
            if (member.roles.cache.has(O_ROLE_ID)) return 2;
            return 1;
        };

        const sortFn = (a, b) => {
            const weightA = getRankWeight(a.member);
            const weightB = getRankWeight(b.member);
            if (weightA !== weightB) return weightB - weightA; // Descending rank
            // If same rank, sort numerically by regNumber (if possible) or alphabetically
            return a.regNumber.localeCompare(b.regNumber, undefined, { numeric: true });
        };

        apMembers.sort(sortFn);
        rpMembers.sort(sortFn);

        // --- REBUILD EMBEDS ---
        console.log(`[INACTIVITY] Rebuilding embeds. AP: ${apMembers.length}, RP: ${rpMembers.length}`);
        await rebuildRegistryEmbed(
            process.env.ENLISTED_CHANNEL_WEBHOOK_URL,
            process.env.AP_EMBED_MESSAGE_ID,
            apMembers
        );

        await rebuildRegistryEmbed(
            process.env.ENLISTED_CHANNEL_WEBHOOK_URL,
            process.env.RP_EMBED_MESSAGE_ID,
            rpMembers
        );

        console.log('[INACTIVITY] Scan and rebuild complete.');
    } catch (err) {
        console.error('[INACTIVITY] Fatal scan error:', err);
    }
}

/**
 * Rebuilds the V2 Component-based embed layout perfectly sorted.
 */
async function rebuildRegistryEmbed(webhookUrl, messageId, sortedMembers) {
    if (!webhookUrl || !messageId) {
        console.log('[INACTIVITY] Missing webhook URL or Message ID. Skipping rebuild.');
        return;
    }

    try {
        const webhook = new WebhookClient({ url: webhookUrl });
        
        // Generate the text block
        const entryLines = sortedMembers.map(item => `<@${item.member.id}> — \`${item.regNumber}\``);
        const textContent = entryLines.length > 0 ? entryLines.join('\n') : '*No personnel currently.*';

        // Assuming V2 Component Layout: type 17 container with accent color
        const updatedComponents = [
            {
                type: 17,
                components: [{ type: 10, content: textContent }],
                accent_color: 196713
            }
        ];

        // Edit via webhook using flags: 32768 for V2 components
        await webhook.editMessage(messageId, {
            components: updatedComponents,
            flags: 32768
        });

    } catch (err) {
        console.error(`[INACTIVITY] Failed to rebuild embed for message ${messageId}:`, err.message);
    }
}
