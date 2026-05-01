/**
 * daily.js — ?daily economy command
 * Base: €2,000 | Max streak: 10 days = €20,000
 */

const BASE_REWARD = 2000;
const MAX_STREAK  = 10;

// Flame bar: 🔥 for earned days, ⬜ for remaining
function flameBar(streak) {
    const filled = Math.min(streak, MAX_STREAK);
    return '🔥'.repeat(filled) + '⬜'.repeat(MAX_STREAK - filled);
}

function todayUTC() {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function yesterdayUTC() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

function midnightTimestamp() {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

export default {
    name: 'daily',
    description: 'Claim your daily bonus (streak gives multiplier up to 10×)',
    async execute(message, args, client) {
        await message.channel.sendTyping();

        const discordId = message.author.id;
        const supabase  = client.supabase;

        try {
            // ── 1. Ensure player is registered ──────────────────
            const { data: player } = await supabase
                .from('players')
                .select('id')
                .eq('discord_id', discordId)
                .maybeSingle();

            if (!player) {
                return message.reply('❌ You are not registered in the UVS system yet. Post a job log first!');
            }

            const today     = todayUTC();
            const yesterday = yesterdayUTC();

            // ── 2. Check existing claim ──────────────────────────
            const { data: claim } = await supabase
                .from('daily_claims')
                .select('last_claimed, streak')
                .eq('discord_id', discordId)
                .maybeSingle();

            if (claim?.last_claimed === today) {
                // Already claimed today
                return message.reply({
                    embeds: [{
                        color: 0x888888,
                        title: '⏰ Already Claimed',
                        description: `You already collected your daily bonus today.\nNext claim: <t:${midnightTimestamp()}:R>`,
                        footer: { text: `Current streak: ${claim.streak} day${claim.streak !== 1 ? 's' : ''}` },
                    }]
                });
            }

            // ── 3. Calculate streak ──────────────────────────────
            let newStreak;
            if (!claim) {
                newStreak = 1;
            } else if (claim.last_claimed === yesterday) {
                newStreak = claim.streak + 1;
            } else {
                newStreak = 1; // streak broken
            }

            const reward = BASE_REWARD * Math.min(newStreak, MAX_STREAK);

            // ── 4. Update wallet + net worth ─────────────────────
            const { data: stats } = await supabase
                .from('player_stats')
                .select('wallet, net_worth')
                .eq('player_id', player.id)
                .maybeSingle();

            const newWallet   = (stats?.wallet   || 0) + reward;
            const newNetWorth = (stats?.net_worth || 0) + reward;

            await supabase
                .from('player_stats')
                .update({ wallet: newWallet, net_worth: newNetWorth })
                .eq('player_id', player.id);

            // ── 5. Upsert claim record ───────────────────────────
            await supabase
                .from('daily_claims')
                .upsert({ discord_id: discordId, last_claimed: today, streak: newStreak, updated_at: new Date().toISOString() });

            // ── 6. Log to economy history ─────────────────────────
            await supabase
                .from('player_economy_history')
                .insert({ player_id: player.id, transaction_type: 'daily_bonus', amount: reward, details: `Daily bonus — Day ${newStreak} streak` });

            // ── 7. Build reply embed ─────────────────────────────
            const isMaxStreak = newStreak >= MAX_STREAK;
            const streakBroken = claim && claim.last_claimed !== yesterday && claim.streak > 0;

            const embed = {
                color: isMaxStreak ? 0xffd700 : 0xe8a020,
                title: isMaxStreak ? '🏆 MAX STREAK! Daily Bonus Claimed' : '✅ Daily Bonus Claimed',
                thumbnail: { url: message.author.displayAvatarURL({ extension: 'png', size: 256 }) },
                fields: [
                    {
                        name: '💰 Reward',
                        value: `**€${reward.toLocaleString()}** added to your wallet`,
                        inline: true,
                    },
                    {
                        name: '🔥 Streak',
                        value: `**${newStreak}** day${newStreak !== 1 ? 's' : ''}${isMaxStreak ? ' (MAX!)' : ''}`,
                        inline: true,
                    },
                    {
                        name: `Progress (${Math.min(newStreak, MAX_STREAK)}/${MAX_STREAK})`,
                        value: flameBar(newStreak),
                        inline: false,
                    },
                ],
                footer: {
                    text: streakBroken
                        ? '💔 Your streak was reset — come back daily to keep it!'
                        : `Next claim: after midnight UTC • Max bonus at ${MAX_STREAK}-day streak`,
                },
                timestamp: new Date(),
            };

            if (newStreak < MAX_STREAK) {
                const daysLeft  = MAX_STREAK - newStreak;
                const maxBonus  = BASE_REWARD * MAX_STREAK;
                embed.fields.push({
                    name: '📈 Next Milestone',
                    value: `${daysLeft} more day${daysLeft !== 1 ? 's' : ''} to reach **€${maxBonus.toLocaleString()}/day**`,
                    inline: false,
                });
            }

            return message.reply({ embeds: [embed] });

        } catch (err) {
            console.error('[DAILY] Error:', err);
            return message.reply('⚠️ An error occurred. Please try again.');
        }
    },
};
