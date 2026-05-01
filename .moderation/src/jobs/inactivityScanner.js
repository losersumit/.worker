/**
 * inactivityScanner.js
 * Runs on bot startup and daily at 1 AM.
 *
 * Scan Order:
 *   1. AP → RP check  (inactive > 7 days → move to RP)
 *   2. RP → AP check  (posting valid job log reactivates — handled in levelSystem.js)
 *   3. RP → RTD check (no runs at all OR last run > 30 days → retire)
 *
 * Retired Personnel (RTD) rules:
 *   - Rank roles (O / FO / SMO) are stripped.
 *   - Enlisted role is stripped.
 *   - Level roles are kept.
 *   - RTD members are NEVER reactivated by posting a job log.
 *   - Full economy access, but cannot buy skins (enforced in interactionCreate.js).
 *   - RTD embed sorted by display-name length (shortest → longest).
 */

import { WebhookClient } from 'discord.js';

const TARGET_GUILD_ID = process.env.GUILD_ID || '1448027116074434593';

// ─── Roles ───────────────────────────────────────────────────────────────────
const ENLISTED_TAG_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1482386008376086598';
const AP_ROLE_ID            = process.env.AP_ROLE_ID       || '1463184412937289973';
const RP_ROLE_ID            = process.env.RP_ROLE_ID       || '1482059608536387795';
const RTD_ROLE_ID           = process.env.RTD_ROLE_ID      || '1499413282279129139';

const SMO_ROLE_ID           = process.env.SMO_ROLE_ID      || '1475314856184778835';
const FO_ROLE_ID            = process.env.FO_ROLE_ID       || '1475314865878077603';
const O_ROLE_ID             = process.env.O_ROLE_ID        || '1475314870802055421';

const RANK_ROLE_IDS = [SMO_ROLE_ID, FO_ROLE_ID, O_ROLE_ID];

const INACTIVITY_DAYS    = 7;
const RTD_INACTIVE_DAYS  = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRankWeight(member) {
    if (member.roles.cache.has(SMO_ROLE_ID)) return 4;
    if (member.roles.cache.has(FO_ROLE_ID))  return 3;
    if (member.roles.cache.has(O_ROLE_ID))   return 2;
    return 1;
}

function sortRegistryMembers(members) {
    members.sort((a, b) => {
        const weightA = getRankWeight(a.member);
        const weightB = getRankWeight(b.member);
        if (weightA !== weightB) return weightB - weightA;
        return a.regNumber.localeCompare(b.regNumber, undefined, { numeric: true });
    });
}

/** Sort RTD members by display-name length (shortest first), then alphabetically. */
function sortRtdMembers(members) {
    members.sort((a, b) => {
        const nameA = a.member.displayName || a.member.user.username;
        const nameB = b.member.displayName || b.member.user.username;
        if (nameA.length !== nameB.length) return nameA.length - nameB.length;
        return nameA.localeCompare(nameB);
    });
}

// ─── Embed Rebuilds ───────────────────────────────────────────────────────────

/**
 * Rebuilds the V2 Component-based embed for AP / RP lists.
 */
async function rebuildRegistryEmbed(webhookUrl, messageId, sortedMembers) {
    if (!webhookUrl || !messageId) {
        console.log('[INACTIVITY] Missing webhook URL or Message ID. Skipping rebuild.');
        return;
    }

    try {
        const webhook = new WebhookClient({ url: webhookUrl });

        let headerText = '# Active Personnel';
        if (messageId === process.env.RP_EMBED_MESSAGE_ID) {
            headerText = '# Reserved Personnel';
        }

        const entryLines = sortedMembers.map(item => `<@${item.member.id}> — \`${item.regNumber}\``);
        const textContent = entryLines.length > 0 ? entryLines.join('\n') : '*No personnel currently.*';

        const updatedComponents = [
            { type: 17, components: [{ type: 10, content: headerText }] },
            { type: 17, components: [{ type: 10, content: textContent }], accent_color: 10181046 }
        ];

        await webhook.editMessage(messageId, { components: updatedComponents, flags: 32768 });
    } catch (err) {
        console.error(`[INACTIVITY] Failed to rebuild embed for message ${messageId}:`, err.message);
    }
}

/**
 * Rebuilds the Retired Personnel embed.
 * Format mirrors the user-provided JSON exactly.
 * Members listed as @mentions sorted by name length (shortest first).
 */
async function rebuildRtdEmbed(webhookUrl, messageId, sortedMembers) {
    if (!webhookUrl || !messageId) {
        console.log('[INACTIVITY] Missing webhook URL or RTD Message ID. Skipping RTD embed rebuild.');
        return;
    }

    try {
        const webhook = new WebhookClient({ url: webhookUrl });

        const entryLines = sortedMembers.map(item => `<@${item.member.id}>`);
        const listContent = entryLines.length > 0
            ? `-# [RTD.] \n${entryLines.join('\n')}`
            : '-# [RTD.] \n*No retired personnel.*';

        const updatedComponents = [
            { type: 17, components: [{ type: 10, content: '# Retired Personnels' }] },
            { type: 17, components: [{ type: 10, content: listContent }], accent_color: 10181046 }
        ];

        await webhook.editMessage(messageId, { components: updatedComponents, flags: 32768 });
        console.log(`[INACTIVITY] RTD embed rebuilt with ${sortedMembers.length} member(s).`);
    } catch (err) {
        console.error(`[INACTIVITY] Failed to rebuild RTD embed for message ${messageId}:`, err.message);
    }
}

// ─── Public helper used by levelSystem.js ────────────────────────────────────

export async function rebuildPersonnelEmbeds(client, supabase) {
    const { apMembers, rpMembers } = await fetchRegistryMembers(client, supabase);

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
}

async function fetchRegistryMembers(client, supabase) {
    const guild = await client.guilds.fetch(TARGET_GUILD_ID);
    if (!guild) throw new Error('Guild not found.');

    const { data: globalEnlisted } = await supabase
        .from('enlisted_drivers')
        .select('discord_id, unit_number');

    if (!globalEnlisted || globalEnlisted.length === 0) {
        return { guild, apMembers: [], rpMembers: [] };
    }

    const apMembers = [];
    const rpMembers = [];

    for (const driver of globalEnlisted) {
        try {
            const member = await guild.members.fetch({ user: driver.discord_id, force: true }).catch(() => null);
            if (!member) continue;
            if (!member.roles.cache.has(ENLISTED_TAG_ROLE_ID)) continue;

            const { data: player } = await supabase
                .from('players')
                .select('registration_number')
                .eq('discord_id', driver.discord_id)
                .maybeSingle();

            const regNumber = player?.registration_number || driver.unit_number || '???';
            const bucket = member.roles.cache.has(RP_ROLE_ID) ? rpMembers : apMembers;
            bucket.push({ member, regNumber });
        } catch (err) {
            console.error(`[INACTIVITY] Error collecting registry member ${driver.discord_id}:`, err.message);
        }
    }

    sortRegistryMembers(apMembers);
    sortRegistryMembers(rpMembers);

    return { guild, apMembers, rpMembers };
}

// ─── Notification helper ──────────────────────────────────────────────────────

async function notifyRetirement(client, member) {
    const channelId = process.env.BONDS_CABIN_CHANNEL_ID;
    if (!channelId) return;
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;
        await channel.send(
            `📋 <@${member.id}> has been moved to **Retired Personnel** due to extended inactivity (no job log in over 30 days or no logs on record). Their rank roles and enlisted status have been removed.`
        );
    } catch (err) {
        console.error(`[INACTIVITY] Failed to send RTD notification for ${member.id}:`, err.message);
    }
}

// ─── Main scan ───────────────────────────────────────────────────────────────

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

        const rtdCutoffDate = new Date();
        rtdCutoffDate.setDate(rtdCutoffDate.getDate() - RTD_INACTIVE_DAYS);

        // Fetch all enlisted drivers from Supabase
        const { data: globalEnlisted } = await supabase
            .from('enlisted_drivers')
            .select('discord_id, created_at, unit_number');

        if (!globalEnlisted || globalEnlisted.length === 0) {
            console.log('[INACTIVITY] No enlisted drivers found in database.');
            return;
        }

        console.log(`[INACTIVITY] Found ${globalEnlisted.length} total enlisted members in DB. Starting individual checks...`);

        const apMembers  = [];
        const rpMembers  = [];

        // ── PHASE 1: AP ↔ RP scan ──────────────────────────────────────────
        for (const driver of globalEnlisted) {
            try {
                const memberId = driver.discord_id;
                const member   = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);

                if (!member) continue;                          // Left the server
                if (!member.roles.cache.has(ENLISTED_TAG_ROLE_ID)) continue; // No enlisted role
                if (member.roles.cache.has(RTD_ROLE_ID)) continue;           // Skip — handled in Phase 2

                const { data: player } = await supabase
                    .from('players')
                    .select('id, registration_number')
                    .eq('discord_id', memberId)
                    .maybeSingle();

                let isInactive = false;
                let enlistDate = new Date(driver.created_at);

                // Grandfathered-user fix: use server join date if enlist date is very recent
                const oneDayAgo = new Date();
                oneDayAgo.setDate(oneDayAgo.getDate() - 1);
                if (enlistDate > oneDayAgo && member.joinedAt && member.joinedAt < oneDayAgo) {
                    enlistDate = member.joinedAt;
                }

                const regNumber = player?.registration_number || driver.unit_number || '???';

                if (player) {
                    const { data: lastRun } = await supabase
                        .from('runs')
                        .select('created_at')
                        .eq('player_id', player.id)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!lastRun) {
                        isInactive = true; // 0 runs
                    } else if (new Date(lastRun.created_at) < cutoffDate) {
                        isInactive = true; // Last run > 7 days ago
                    }
                } else {
                    isInactive = true; // Not in players table
                }

                if (isInactive) {
                    // Move to / Stay in RP
                    if (member.roles.cache.has(AP_ROLE_ID)) await member.roles.remove(AP_ROLE_ID);
                    if (!member.roles.cache.has(RP_ROLE_ID)) await member.roles.add(RP_ROLE_ID);

                    const currentNick = member.nickname || member.user.username;
                    if (!currentNick.startsWith('[RP]')) {
                        const newNick = `[RP] ${currentNick}`.substring(0, 32);
                        await member.setNickname(newNick).catch(() => {});
                    }

                    await supabase.from('enlisted_drivers').update({ status: 'RP' }).eq('discord_id', memberId);
                    rpMembers.push({ member, regNumber });
                } else {
                    // Move to / Stay in AP
                    if (member.roles.cache.has(RP_ROLE_ID)) await member.roles.remove(RP_ROLE_ID);
                    if (!member.roles.cache.has(AP_ROLE_ID)) await member.roles.add(AP_ROLE_ID);

                    const currentNick = member.nickname || member.user.username;
                    if (currentNick.startsWith('[RP] ')) {
                        const newNick = currentNick.replace('[RP] ', '').substring(0, 32);
                        await member.setNickname(newNick).catch(() => {});
                    }

                    await supabase.from('enlisted_drivers').update({ status: 'AP' }).eq('discord_id', memberId);
                    apMembers.push({ member, regNumber });
                }

                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                console.error(`[INACTIVITY] Error processing member ${driver.discord_id}:`, err.message);
            }
        }

        // ── Rebuild AP + RP embeds ─────────────────────────────────────────
        sortRegistryMembers(apMembers);
        sortRegistryMembers(rpMembers);
        console.log(`[INACTIVITY] Rebuilding AP/RP embeds. AP: ${apMembers.length}, RP: ${rpMembers.length}`);

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

        console.log('[INACTIVITY] AP/RP scan complete. Starting Retired Personnel scan...');

        // ── PHASE 2: RP → RTD scan ────────────────────────────────────────
        // Re-fetch to catch any who were just moved to RP in Phase 1.
        const { data: freshEnlisted } = await supabase
            .from('enlisted_drivers')
            .select('discord_id, unit_number');

        const rtdMembers = [];
        const retiredInPhase2 = new Set(); // Track IDs retired this run so RP embed can be corrected

        // ── Collect existing RTD members via Discord role (source of truth) ──
        // Do NOT rely solely on DB status='RTD' — rows can be lost if the enlisted
        // role removal fires guildMemberUpdate before the RTD status is written.
        // Instead, fetch all guild members who currently have the RTD role, and
        // re-sync any missing DB rows on the fly.
        console.log('[INACTIVITY] Collecting existing RTD members from Discord role...');
        try {
            const allGuildMembers = await guild.members.fetch();
            for (const [, member] of allGuildMembers) {
                if (!member.roles.cache.has(RTD_ROLE_ID)) continue;

                // Re-sync DB row if missing (self-healing)
                const { data: existing } = await supabase
                    .from('enlisted_drivers')
                    .select('discord_id, status')
                    .eq('discord_id', member.id)
                    .maybeSingle();

                if (!existing) {
                    // Row was lost — re-insert with RTD status
                    console.log(`[INACTIVITY] Re-syncing missing RTD row for ${member.user.username}`);
                    await supabase.from('enlisted_drivers').upsert({
                        discord_id:   member.id,
                        display_name: member.displayName || member.user.username,
                        status:       'RTD'
                    }, { onConflict: 'discord_id' });
                } else if (existing.status !== 'RTD') {
                    // Row exists but status is wrong — correct it
                    await supabase.from('enlisted_drivers')
                        .update({ status: 'RTD' })
                        .eq('discord_id', member.id);
                }

                rtdMembers.push({ member });
            }
            console.log(`[INACTIVITY] Found ${rtdMembers.length} existing RTD member(s) via Discord role.`);
        } catch (err) {
            console.error('[INACTIVITY] Error collecting RTD members from Discord:', err.message);
        }

        // Now scan RP members for retirement eligibility
        for (const driver of (freshEnlisted || [])) {
            try {
                const memberId = driver.discord_id;
                const member   = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);

                if (!member) continue;
                // Only scan Enlisted members who have RP role
                if (!member.roles.cache.has(ENLISTED_TAG_ROLE_ID)) continue;
                if (!member.roles.cache.has(RP_ROLE_ID)) continue;
                // Skip anyone already RTD (already counted above)
                if (member.roles.cache.has(RTD_ROLE_ID)) continue;

                const { data: player } = await supabase
                    .from('players')
                    .select('id')
                    .eq('discord_id', memberId)
                    .maybeSingle();

                let shouldRetire = false;

                if (player) {
                    const { data: lastRun } = await supabase
                        .from('runs')
                        .select('created_at')
                        .eq('player_id', player.id)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (!lastRun) {
                        shouldRetire = true; // No runs at all
                    } else if (new Date(lastRun.created_at) < rtdCutoffDate) {
                        shouldRetire = true; // Last run > 30 days ago
                    }
                } else {
                    shouldRetire = true; // No player record at all
                }

                if (!shouldRetire) continue;

                console.log(`[INACTIVITY] Retiring ${member.user.username} (${memberId}) → RTD`);

                // ── Role changes ──────────────────────────────────────────
                // Remove RP and AP (safety)
                if (member.roles.cache.has(RP_ROLE_ID)) await member.roles.remove(RP_ROLE_ID).catch(() => {});
                if (member.roles.cache.has(AP_ROLE_ID)) await member.roles.remove(AP_ROLE_ID).catch(() => {});

                // Strip rank roles
                for (const rankId of RANK_ROLE_IDS) {
                    if (member.roles.cache.has(rankId)) {
                        await member.roles.remove(rankId).catch(() => {});
                    }
                }

                // Strip enlisted role
                if (member.roles.cache.has(ENLISTED_TAG_ROLE_ID)) {
                    await member.roles.remove(ENLISTED_TAG_ROLE_ID).catch(() => {});
                }

                // Add RTD role
                await member.roles.add(RTD_ROLE_ID).catch(() => {});

                // ── Nickname ─────────────────────────────────────────────
                const currentNick = member.nickname || member.user.username;
                // Strip all status/rank prefixes: [RP], [Rtd.], [SMO], [FO], [O]
                const cleanedNick = currentNick
                    .replace(/\[RP\]\s*/gi, '')
                    .replace(/\[Rtd\.\]\s*/gi, '')
                    .replace(/\[SMO\]\s*/gi, '')
                    .replace(/\[FO\]\s*/gi, '')
                    .replace(/\[O\]\s*/gi, '')
                    .trim();
                const newNick = `[Rtd.] ${cleanedNick}`.substring(0, 32);
                await member.setNickname(newNick).catch(() => {});

                // Track retired member ID so RP embed can exclude them
                retiredInPhase2.add(memberId);

                // ── DB update ─────────────────────────────────────────────
                await supabase.from('enlisted_drivers').update({ status: 'RTD' }).eq('discord_id', memberId);

                // ── Notify in Bond's Cabin ────────────────────────────────
                await notifyRetirement(client, member);

                rtdMembers.push({ member });

                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                console.error(`[INACTIVITY] Error processing RTD candidate ${driver.discord_id}:`, err.message);
            }
        }

        // ── Rebuild RTD embed ──────────────────────────────────────────────
        sortRtdMembers(rtdMembers);
        await rebuildRtdEmbed(
            process.env.ENLISTED_CHANNEL_WEBHOOK_URL,
            process.env.RTD_EMBED_MESSAGE_ID,
            rtdMembers
        );

        // ── Rebuild RP embed again, excluding anyone just retired ──────────
        if (retiredInPhase2.size > 0) {
            const updatedRpMembers = rpMembers.filter(item => !retiredInPhase2.has(item.member.id));
            console.log(`[INACTIVITY] Rebuilding RP embed after RTD removals. RP: ${updatedRpMembers.length} (removed ${retiredInPhase2.size} retired)`);
            await rebuildRegistryEmbed(
                process.env.ENLISTED_CHANNEL_WEBHOOK_URL,
                process.env.RP_EMBED_MESSAGE_ID,
                updatedRpMembers
            );
        }

        console.log('[INACTIVITY] Full scan complete. AP, RP, and RTD embeds rebuilt.');

    } catch (err) {
        console.error('[INACTIVITY] Fatal scan error:', err);
    }
}
