import { EmbedBuilder } from 'discord.js';
import { groqChatCompletion } from '../../.moderation/src/clients/groq.js';
import config from '../../.moderation/src/config.js';

const COOLDOWN_MS = 6 * 60 * 60 * 1000;       // 6 hours
const BONUS_AMOUNT = 20000;
const MAX_STREAK = 7;

function flameBar(streak) {
    const filled = Math.min(streak, MAX_STREAK);
    return '🔥'.repeat(filled) + '⬜'.repeat(MAX_STREAK - filled);
}

function getGmt530DateString(date) {
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const localTime = new Date(date.getTime() + offsetMs);
    return localTime.toISOString().slice(0, 10);
}

// Trucking side quest premium fallbacks
const STORY_FALLBACKS = [
    (reward) => `You completed an urgent cargo transport of steel coils and earned €${reward.toLocaleString()} from the local steelworks company.`,
    (reward) => `You helped tow a stranded commercial truck out of a muddy shoulder, and the grateful driver rewarded you with €${reward.toLocaleString()}.`,
    (reward) => `You safely navigated your heavy rig through a torrential downpour to deliver fresh produce, earning €${reward.toLocaleString()} from the warehouse manager.`,
    (reward) => `You spotted a hazardous tire blowout on another rig, helped the driver change it, and was rewarded with €${reward.toLocaleString()}.`,
    (reward) => `You completed a scenic delivery of luxury motorhomes along the coastal highway, earning €${reward.toLocaleString()} in cargo commissions.`,
    (reward) => `You safely transported oversized windmill turbine parts to a renewable energy site, receiving a payout of €${reward.toLocaleString()}.`,
    (reward) => `You worked a night shift hauling dry goods to a logistics center and earned a premium route rate of €${reward.toLocaleString()}.`
];

export default {
    name: 'work',
    description: 'Do trucking-related side quests for random rewards and maintain a 7-day streak for a bonus!',
    async execute(message, args, client) {
        if (!message.guildId) {
            return message.reply('❌ This command can only be used in a server channel.');
        }

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

            const now = new Date();
            const todayDateStr = getGmt530DateString(now);

            // ── 2. Check existing claim ──────────────────────────
            const { data: claim } = await supabase
                .from('daily_claims')
                .select('last_claimed, streak, updated_at')
                .eq('discord_id', discordId)
                .maybeSingle();

            const lastClaimedTime = claim && claim.updated_at ? new Date(claim.updated_at).getTime() : 0;
            const timePassed = now.getTime() - lastClaimedTime;

            if (claim && timePassed < COOLDOWN_MS) {
                const timeLeftMs = COOLDOWN_MS - timePassed;
                const hours = Math.floor(timeLeftMs / (60 * 60 * 1000));
                const minutes = Math.floor((timeLeftMs % (60 * 60 * 1000)) / (60 * 1000));
                const seconds = Math.floor((timeLeftMs % (60 * 1000)) / 1000);
                
                const nextClaimTimestamp = Math.floor((lastClaimedTime + COOLDOWN_MS) / 1000);
                
                return message.reply({
                    embeds: [{
                        color: 0x888888,
                        title: '⏰ Cooldown Active',
                        description: `You can work again in **${hours}h ${minutes}m ${seconds}s**.\nNext work shift: <t:${nextClaimTimestamp}:R>`,
                        footer: { text: `Current streak: ${claim.streak} day${claim.streak !== 1 ? 's' : ''}` },
                    }]
                });
            }

            // ── 3. Calculate streak ──────────────────────────────
            let newStreak;
            let diffDays = 0;
            if (!claim) {
                newStreak = 1;
            } else {
                const lastClaimDateStr = claim.last_claimed || getGmt530DateString(new Date(claim.updated_at));
                const d1 = new Date(lastClaimDateStr);
                const d2 = new Date(todayDateStr);
                const diffTime = Math.abs(d2 - d1);
                diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > 1) {
                    newStreak = 1; // streak broken
                } else if (diffDays === 1) {
                    newStreak = claim.streak + 1; // next day
                } else {
                    newStreak = claim.streak; // same day
                }
            }

            // Random trucking amount between 1 and 2000
            const baseReward = Math.floor(Math.random() * 2000) + 1;
            let reward = baseReward;
            let isBonusClaimed = false;

            if (newStreak >= MAX_STREAK) {
                reward += BONUS_AMOUNT;
                isBonusClaimed = true;
            }

            // ── 4. Verify company treasury (guild_income) ────────
            const { data: guild } = await supabase
                .from('approved_guilds')
                .select('guild_income')
                .eq('guild_id', message.guildId)
                .maybeSingle();

            const companyBalance = parseFloat(guild?.guild_income || 0);
            if (companyBalance < reward) {
                return message.reply(`❌ The company treasury is empty or has insufficient funds (€${companyBalance.toLocaleString()}) to pay you right now. Please notify the administrators!`);
            }

            // ── 5. Perform transfer (Atomic RPC with rollback fallback) ──
            const { data: stats } = await supabase
                .from('player_stats')
                .select('wallet, net_worth')
                .eq('player_id', player.id)
                .maybeSingle();

            const newWallet   = (stats?.wallet   || 0) + reward;
            const newNetWorth = (stats?.net_worth || 0) + reward;

            // Step A: Deduct from company
            const { error: deductError } = await supabase.rpc('adjust_guild_income', { 
                p_guild_id: message.guildId, 
                p_amount: -reward 
            });

            if (deductError) {
                console.error('[WORK] Treasury deduction failed:', deductError);
                return message.reply('⚠️ Treasury transfer failed. Please try again.');
            }

            // Step B: Update player stats
            const { error: updatePlayerError } = await supabase
                .from('player_stats')
                .update({ wallet: newWallet, net_worth: newNetWorth })
                .eq('player_id', player.id);

            if (updatePlayerError) {
                console.error('[WORK] Wallet update failed, rolling back treasury:', updatePlayerError);
                // Rollback treasury deduction
                await supabase.rpc('adjust_guild_income', { 
                    p_guild_id: message.guildId, 
                    p_amount: reward 
                }).catch(rollbackErr => console.error('[WORK] Rollback failed:', rollbackErr));
                
                return message.reply('⚠️ Failed to add money to your wallet. Transaction rolled back.');
            }

            // ── 6. Upsert claim record ───────────────────────────
            // If the 7-day bonus is claimed, reset the streak back to 1 for the next cycle
            const databaseStreak = isBonusClaimed ? 1 : newStreak;
            await supabase
                .from('daily_claims')
                .upsert({ 
                    discord_id: discordId, 
                    last_claimed: todayDateStr, 
                    streak: databaseStreak, 
                    updated_at: now.toISOString() 
                });

            // ── 7. Log to economy history ─────────────────────────
            await supabase
                .from('player_economy_history')
                .insert({ 
                    player_id: player.id, 
                    transaction_type: 'work', 
                    amount: reward, 
                    details: isBonusClaimed 
                        ? `Trucking work — Day 7 streak bonus claimed (+€20,000)` 
                        : `Trucking work — Day ${newStreak} streak` 
                });

            // ── 8. Generate Side Quest Story using Groq AI ────────
            let creativeComment = '';
            try {
                const aiPrompt = `You are a creative writer for a trucking Discord bot economy game. Write a very short, engaging, one-sentence side quest comment where a truck driver does a trucking-related job, delivery, or a random roadside encounter, and earns exactly €${baseReward.toLocaleString()} euros.

Requirements:
- Must mention a realistic trucking action or roadside help.
- Must mention the exact amount: €${baseReward.toLocaleString()}.
- Do not include any intro, outro, quotes, markdown formatting, or extra sentences. Only return the one-sentence comment itself.

Example: You helped a family from a car accident on the road and they rewarded you with €1,700.`;

                const aiResponse = await groqChatCompletion({
                    model: config.ai.model,
                    messages: [{ role: 'user', content: aiPrompt }],
                    temperature: 0.8,
                    max_tokens: 60
                });

                const generatedStory = aiResponse?.choices?.[0]?.message?.content?.trim();
                if (generatedStory) {
                    creativeComment = generatedStory.replace(/^["']|["']$/g, '');
                }
            } catch (aiErr) {
                console.error('[WORK] Groq AI generation failed, using fallback:', aiErr);
            }

            if (!creativeComment) {
                // Fallback to random story helper if AI fails
                const randomFallback = STORY_FALLBACKS[Math.floor(Math.random() * STORY_FALLBACKS.length)];
                creativeComment = randomFallback(baseReward);
            }

            // Append bonus detail to description if 7-day milestone is reached
            if (isBonusClaimed) {
                creativeComment += `\n\n🏆 **7-DAY WEEKLY BONUS!** You maintained your work streak for 7 days, earning an additional **€20,000** bonus from the company treasury!`;
            }

            // ── 9. Build reply embed ─────────────────────────────
            const embed = new EmbedBuilder()
                .setColor(isBonusClaimed ? 0xffd700 : 0x0099ff)
                .setTitle(isBonusClaimed ? '🏆 WEEKLY BONUS! Trucking Quest Completed' : '🚛 Trucking Side Quest Completed')
                .setThumbnail(message.author.displayAvatarURL({ extension: 'png', size: 256 }))
                .setDescription(creativeComment)
                .addFields(
                    {
                        name: '💰 Total Earnings',
                        value: `**€${reward.toLocaleString()}**`,
                        inline: true,
                    },
                    {
                        name: '🔥 Streak Progress',
                        value: `**${newStreak}** / ${MAX_STREAK} days`,
                        inline: true,
                    },
                    {
                        name: `Milestone Progress (${newStreak}/${MAX_STREAK})`,
                        value: flameBar(newStreak),
                        inline: false,
                    }
                )
                .setFooter({
                    text: isBonusClaimed
                        ? '🎉 Streak successfully milestone claimed! A new cycle has begun.'
                        : (claim && diffDays > 1)
                            ? '💔 Your streak was reset because you didn\'t work yesterday (GMT+5:30).'
                            : 'Next work available in 6 hours • Keep working daily (GMT+5:30) to maintain your streak!',
                })
                .setTimestamp();

            return message.reply({ embeds: [embed] });

        } catch (err) {
            console.error('[WORK] Command error:', err);
            return message.reply('⚠️ An error occurred while executing your work quest. Please try again.');
        }
    },
};
