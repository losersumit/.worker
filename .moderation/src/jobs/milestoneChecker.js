/**
 * milestoneChecker.js
 * ──────────────────────────────────────────────────────────────
 * Event-driven milestone announcements.
 * Triggered by Supabase Realtime on `runs` INSERT events.
 * When a new run is logged for an NMC player, fetches their
 * current stats and checks all milestone thresholds.
 * New milestones are announced in ANNOUNCEMENTS_CHANNEL_ID
 * and recorded in announced_milestones to prevent duplicates.
 * ──────────────────────────────────────────────────────────────
 */

import { EmbedBuilder } from 'discord.js';

const GUILD_ID         = process.env.GUILD_ID;
const ANNOUNCE_CHANNEL = process.env.MILESTONES_CHANNEL_ID;

// ── Milestone definitions ─────────────────────────────────────
const MILESTONES = [
    {
        key:    'runs',
        label:  'Total Runs',
        icon:   '🚛',
        thresholds: [10, 25, 50, 100, 250, 500, 1000],
        format: n => `${n} runs logged`,
        message: (name, n) => `**${name}** just logged their **${n}th delivery**!`,
    },
    {
        key:    'total_distance_km',
        label:  'Distance',
        icon:   '📍',
        thresholds: [1000, 5000, 10000, 25000, 50000],
        format: n => `${n.toLocaleString()} km driven`,
        message: (name, n) => `**${name}** has now driven **${n.toLocaleString()} km** total!`,
    },
    {
        key:    'level',
        label:  'Level',
        icon:   '⬆️',
        thresholds: [5, 10, 15, 20, 25, 30, 50],
        format: n => `Level ${n}`,
        message: (name, n) => `**${name}** reached **Level ${n}**!`,
    },
    {
        key:    'clean_deliveries',
        label:  'Clean Deliveries',
        icon:   '✅',
        thresholds: [10, 25, 50, 100, 250],
        format: n => `${n} clean deliveries`,
        message: (name, n) => `**${name}** hit **${n} clean deliveries** — no damage, no excuses!`,
    },
    {
        key:    'total_stars',
        label:  'Stars',
        icon:   '⭐',
        thresholds: [50, 100, 250, 500, 1000],
        format: n => `${n} stars earned`,
        message: (name, n) => `**${name}** has collected **${n} stars** total!`,
    },
];

// ── Check milestones for a single player ─────────────────────
// silent=true → only inserts into DB, does NOT post to Discord (used on boot)
async function checkMilestones(client, supabase, discordId, playerId, displayName, silent = false) {
    if (!ANNOUNCE_CHANNEL) return;

    // Fetch current stats
    const { data: stats } = await supabase
        .from('player_stats')
        .select('runs, total_distance_km, level, clean_deliveries, total_stars')
        .eq('player_id', playerId)
        .maybeSingle();

    if (!stats) return;

    // Fetch already-announced milestones for this player
    const { data: announced } = await supabase
        .from('announced_milestones')
        .select('milestone')
        .eq('discord_id', discordId);

    const announcedSet = new Set((announced || []).map(r => r.milestone));

    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL).catch(() => null);
    if (!channel) return;

    for (const def of MILESTONES) {
        const current = Number(stats[def.key] || 0);

        for (const threshold of def.thresholds) {
            if (current < threshold) break; // thresholds are ascending, no need to check further

            const milestoneId = `${def.key}_${threshold}`;
            if (announcedSet.has(milestoneId)) continue; // already announced

            // New milestone hit
            try {
                if (!silent) {
                    // Get avatar
                    let avatarUrl = null;
                    try {
                        const user = await client.users.fetch(discordId);
                        avatarUrl = user.displayAvatarURL({ extension: 'png', size: 256 });
                    } catch { /* ignore */ }

                    const embed = new EmbedBuilder()
                        .setColor(0xf0a500)
                        .setTitle(`${def.icon} Milestone Reached!`)
                        .setDescription(def.message(displayName, threshold))
                        .addFields(
                            { name: def.label, value: def.format(threshold), inline: true },
                            { name: 'Current',  value: def.format(current),   inline: true },
                        )
                        .setFooter({ text: 'NMC • Milestones' })
                        .setTimestamp();

                    if (avatarUrl) embed.setThumbnail(avatarUrl);

                    await channel.send({ embeds: [embed] });
                    console.log(`[MILESTONE] ${displayName} — ${milestoneId}`);
                }

                // Record as announced (silent or not)
                await supabase
                    .from('announced_milestones')
                    .insert({ discord_id: discordId, milestone: milestoneId });

                announcedSet.add(milestoneId);

            } catch (err) {
                console.error(`[MILESTONE] Error on ${milestoneId} for ${displayName}:`, err.message);
            }
        }
    }
}

// ── Startup: silently backfill all existing milestones ───────
// Records all milestones already passed WITHOUT posting to Discord.
// Only NEW milestones (after bot startup) are announced.
async function runBootCheck(client, supabase) {
    const { data: players } = await supabase
        .from('players')
        .select('id, discord_id, display_name, username')
        .eq('guild_id', GUILD_ID);

    if (!players?.length) return;
    console.log(`[MILESTONE] Silently backfilling milestones for ${players.length} NMC players…`);

    for (const p of players) {
        const name = p.display_name || p.username || 'Driver';
        await checkMilestones(client, supabase, p.discord_id, p.id, name, true).catch(() => {});
    }

    console.log('[MILESTONE] Backfill complete. Watching for new milestones going forward.');
}

// ── Supabase Realtime listener on runs INSERT ─────────────────
export function startMilestoneChecker(client, supabase) {
    if (!ANNOUNCE_CHANNEL) {
        console.warn('[MILESTONE] ANNOUNCEMENTS_CHANNEL_ID not set — milestone checker disabled.');
        return;
    }

    // Boot scan — catch any missed milestones from before this session
    runBootCheck(client, supabase).catch(err =>
        console.error('[MILESTONE] Boot check error:', err.message)
    );

    // Real-time trigger: fire on every new run INSERT
    supabase
        .channel('runs-milestone-trigger')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'runs' },
            async (payload) => {
                const run = payload.new;
                if (!run?.player_id) return;

                try {
                    // Get player info — verify they're an NMC member
                    const { data: player } = await supabase
                        .from('players')
                        .select('id, discord_id, display_name, username, guild_id')
                        .eq('id', run.player_id)
                        .maybeSingle();

                    if (!player || player.guild_id !== GUILD_ID) return;

                    const name = player.display_name || player.username || 'Driver';
                    await checkMilestones(client, supabase, player.discord_id, player.id, name);

                } catch (err) {
                    console.error('[MILESTONE] Realtime handler error:', err.message);
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[MILESTONE] Realtime listener active — watching runs INSERT events.');
            }
        });
}
