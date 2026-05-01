/**
 * weeklyAwards.js
 * ──────────────────────────────────────────────────────────────
 * Runs every Sunday at 9:00 PM (Europe/London).
 * Posts two awards to ANNOUNCEMENTS_CHANNEL_ID:
 *   1. Job of the Week  — single run with highest score
 *   2. Driver of the Week — driver with highest sum of scores
 *      → rewarded €40,000 from server economy
 * ──────────────────────────────────────────────────────────────
 */

import { EmbedBuilder } from 'discord.js';

const GUILD_ID         = process.env.GUILD_ID;
const ANNOUNCE_CHANNEL = process.env.ANNOUNCEMENTS_CHANNEL_ID;
const DOTW_REWARD      = 40_000;

function weekStart() {
    // Monday 00:00 UTC of current week
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun … 6=Sat
    const diff = (day === 0 ? -6 : 1 - day); // days back to Monday
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString();
}

function fmt(n) { return Number(n || 0).toLocaleString(); }
function fmtTime(minutes) {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── Fetch winner avatar from Discord ─────────────────────────
async function getAvatar(client, discordId) {
    try {
        const user = await client.users.fetch(discordId);
        return user.displayAvatarURL({ extension: 'png', size: 256 });
    } catch { return null; }
}

// ── 1. Job of the Week ────────────────────────────────────────
async function postJobOfTheWeek(client, supabase, channel) {
    const since = weekStart();

    const { data: topRun, error } = await supabase
        .from('runs')
        .select(`
            id, score, stars, income, distance, time_taken, created_at,
            players!inner(discord_id, display_name, username, guild_id)
        `)
        .eq('players.guild_id', GUILD_ID)
        .gte('created_at', since)
        .order('score', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !topRun) {
        console.log('[AWARDS] JOTW: No runs found this week.');
        return;
    }

    const player  = topRun.players;
    const avatar  = await getAvatar(client, player.discord_id);
    const name    = player.display_name || player.username || 'Unknown Driver';
    const runDate = new Date(topRun.created_at);

    const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('🏆 Job of the Week')
        .setDescription(`**${name}** posted the highest-scoring job log this week!\n*This single run stood above all others.*`)
        .addFields(
            { name: '⭐ Score',    value: fmt(topRun.score),    inline: true },
            { name: '🌟 Stars',    value: fmt(topRun.stars),    inline: true },
            { name: '💰 Income',   value: `€${fmt(topRun.income)}`, inline: true },
            { name: '🚛 Distance', value: `${fmt(topRun.distance)} km`, inline: true },
            { name: '⏱️ Time',     value: fmtTime(topRun.time_taken), inline: true },
            { name: '📅 Logged',   value: `<t:${Math.floor(runDate.getTime() / 1000)}:F>`, inline: true },
        )
        .setFooter({ text: 'NMC • Job of the Week' })
        .setTimestamp();

    if (avatar) embed.setThumbnail(avatar);

    await channel.send({ embeds: [embed] });
    console.log(`[AWARDS] JOTW posted — ${name} (score: ${topRun.score})`);
}

// ── 2. Driver of the Week ─────────────────────────────────────
async function postDriverOfTheWeek(client, supabase, channel) {
    const since = weekStart();

    // Sum scores per NMC driver this week
    const { data: leaderboard, error } = await supabase
        .from('runs')
        .select(`
            player_id, score,
            players!inner(id, discord_id, display_name, username, guild_id)
        `)
        .eq('players.guild_id', GUILD_ID)
        .gte('created_at', since);

    if (error || !leaderboard?.length) {
        console.log('[AWARDS] DOTW: No runs found this week.');
        return;
    }

    // Aggregate scores per player
    const totals = {};
    for (const row of leaderboard) {
        const pid = row.player_id;
        if (!totals[pid]) {
            totals[pid] = {
                player_id:    row.players.id,
                discord_id:   row.players.discord_id,
                display_name: row.players.display_name || row.players.username || 'Unknown',
                total_score:  0,
                total_runs:   0,
            };
        }
        totals[pid].total_score += Number(row.score || 0);
        totals[pid].total_runs  += 1;
    }

    const winner = Object.values(totals).sort((a, b) => b.total_score - a.total_score)[0];
    if (!winner) return;

    // ── Award €40,000 to winner ──────────────────────────────
    const { data: stats } = await supabase
        .from('player_stats')
        .select('wallet, net_worth')
        .eq('player_id', winner.player_id)
        .maybeSingle();

    await supabase
        .from('player_stats')
        .update({
            wallet:    (stats?.wallet    || 0) + DOTW_REWARD,
            net_worth: (stats?.net_worth || 0) + DOTW_REWARD,
        })
        .eq('player_id', winner.player_id);

    await supabase
        .from('player_economy_history')
        .insert({
            player_id:        winner.player_id,
            transaction_type: 'driver_of_week',
            amount:           DOTW_REWARD,
            details:          `Driver of the Week reward — Week of ${since.slice(0, 10)}`,
        });

    // ── Post embed ────────────────────────────────────────────
    const avatar = await getAvatar(client, winner.discord_id);

    const embed = new EmbedBuilder()
        .setColor(0xf0a500)
        .setTitle('🌟 Driver of the Week')
        .setDescription(
            `Congratulations to **${winner.display_name}** for the highest combined score this week!\n` +
            `Rewarded **€${DOTW_REWARD.toLocaleString()}** from the server economy. 🎉`
        )
        .addFields(
            { name: '📊 Total Score', value: fmt(winner.total_score), inline: true },
            { name: '🚛 Runs Logged', value: fmt(winner.total_runs),  inline: true },
            { name: '💰 Reward',      value: `€${fmt(DOTW_REWARD)}`,  inline: true },
        )
        .setFooter({ text: 'NMC • Driver of the Week' })
        .setTimestamp();

    if (avatar) embed.setThumbnail(avatar);

    await channel.send({ embeds: [embed] });
    console.log(`[AWARDS] DOTW posted — ${winner.display_name} (total score: ${winner.total_score})`);
}

// ── Main runner ───────────────────────────────────────────────
export async function runWeeklyAwards(client, supabase) {
    if (!ANNOUNCE_CHANNEL) {
        console.warn('[AWARDS] ANNOUNCEMENTS_CHANNEL_ID not set — skipping weekly awards.');
        return;
    }

    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL).catch(() => null);
    if (!channel) {
        console.warn('[AWARDS] Announcements channel not found.');
        return;
    }

    console.log('[AWARDS] Running weekly awards…');
    await postJobOfTheWeek(client, supabase, channel);
    await postDriverOfTheWeek(client, supabase, channel);
    console.log('[AWARDS] Weekly awards complete.');
}
