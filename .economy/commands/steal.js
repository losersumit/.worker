import { EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';
import { groqChatCompletion } from '../../.moderation/src/clients/groq.js';

// Cooldown maps: discordId -> timestamp
const globalCooldowns = new Map();     // 1 hour between any steal
const victimCooldowns = new Map();     // 3 hours per robber→victim pair
const alertCooldowns = new Map();      // 1 hour victim alert — no one can rob this victim

const GLOBAL_CD = 60 * 60 * 1000;     // 1 hour in ms
const VICTIM_CD = 3 * 60 * 60 * 1000; // 3 hours in ms
const ALERT_CD = 60 * 60 * 1000;      // 1 hour alert mode
const TIMEOUT_DURATION = 30 * 60 * 1000; // 30 min timeout on failure

/**
 * Generate a sarcastic roast for a failed robbery using Groq AI.
 */
async function getSarcasticMessage(username) {
    try {
        const result = await groqChatCompletion({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'You are a sarcastic narrator in a Discord economy game. Generate ONE short, funny, sarcastic line (max 15 words) roasting a player who just failed a robbery and got caught. Be creative and brutal. No hashtags, no emojis, just raw wit. Vary your response every time.'
                },
                {
                    role: 'user',
                    content: `The player "${username}" just tried to rob someone and failed miserably. Roast them.`
                }
            ],
            max_tokens: 60,
            temperature: 1.2,
        });

        const line = result?.choices?.[0]?.message?.content?.trim();
        return line || getLocalFallback();
    } catch (err) {
        console.error('[Steal] Failed to generate AI sarcasm:', err.message);
        return getLocalFallback();
    }
}

function getLocalFallback() {
    const lines = [
        "Crime doesn't pay, and neither do you apparently.",
        "You'd lose a heist in a Monopoly game.",
        "The only thing you stole was everyone's time.",
        "Ocean's Eleven would've kicked you off at auditions.",
        "Your robbery skills are about as sharp as a bowling ball.",
        "Even the security cameras felt sorry for you.",
        "You tripped over your own shoelaces mid-robbery.",
        "Congratulations, you played yourself.",
    ];
    return lines[Math.floor(Math.random() * lines.length)];
}

export default {
    name: 'steal',
    description: 'Attempt to steal money from another player',
    async execute(message, args, client) {
        await message.channel.sendTyping();

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('Usage: `?steal @user` — Try to rob another player.');
        }

        if (targetUser.id === message.author.id) {
            return message.reply("You can't rob yourself... that's just moving money between pockets.");
        }

        if (targetUser.bot) {
            return message.reply('You cannot steal from bots.');
        }

        try {
            // --- Cooldown Checks ---
            const now = Date.now();

            // Global cooldown (1h)
            const lastSteal = globalCooldowns.get(message.author.id);
            if (lastSteal && now - lastSteal < GLOBAL_CD) {
                const remaining = Math.ceil((GLOBAL_CD - (now - lastSteal)) / 60000);
                return message.reply(`🕐 You need to lay low for **${remaining} more minute${remaining !== 1 ? 's' : ''}** before attempting another robbery.`);
            }

            // Per-victim cooldown (3h)
            const pairKey = `${message.author.id}_${targetUser.id}`;
            const lastVictimSteal = victimCooldowns.get(pairKey);
            if (lastVictimSteal && now - lastVictimSteal < VICTIM_CD) {
                const remaining = Math.ceil((VICTIM_CD - (now - lastVictimSteal)) / 60000);
                return message.reply(`🕐 You can't rob **${targetUser.username}** again for **${remaining} more minute${remaining !== 1 ? 's' : ''}**.`);
            }

            // Victim alert mode (1h — no one can rob this victim)
            const victimAlert = alertCooldowns.get(targetUser.id);
            if (victimAlert && now - victimAlert < ALERT_CD) {
                const remaining = Math.ceil((ALERT_CD - (now - victimAlert)) / 60000);
                return message.reply(`🚨 **${targetUser.username}** is on alert! They can't be robbed for **${remaining} more minute${remaining !== 1 ? 's' : ''}**.`);
            }

            // --- Fetch Players ---
            const [robberResult, victimResult] = await Promise.all([
                client.supabase.from('players').select('id').eq('discord_id', message.author.id).single(),
                client.supabase.from('players').select('id').eq('discord_id', targetUser.id).single(),
            ]);

            const robber = robberResult.data;
            const victim = victimResult.data;

            if (!robber) return message.reply('You are not registered in the economy system.');
            if (!victim) return message.reply('That user is not registered in the economy system.');

            // Fetch victim's total_income
            const { data: victimStats } = await client.supabase
                .from('player_stats')
                .select('total_income')
                .eq('player_id', victim.id)
                .single();

            if (!victimStats || victimStats.total_income <= 0) {
                return message.reply(`**${targetUser.username}** has no money in their wallet to steal!`);
            }

            // --- Generate random steal amount ---
            const maxSteal = victimStats.total_income;
            const stealAmount = Math.floor(Math.random() * maxSteal) + 1;

            // --- 50/50 Chance ---
            const success = Math.random() < 0.5;

            // Set cooldowns regardless of outcome
            globalCooldowns.set(message.author.id, now);
            victimCooldowns.set(pairKey, now);
            // Put victim on alert after any robbery attempt
            alertCooldowns.set(targetUser.id, now);

            if (success) {
                // --- SUCCESS ---
                // Fetch latest balances
                const [robberStats, freshVictim] = await Promise.all([
                    client.supabase.from('player_stats').select('total_income').eq('player_id', robber.id).single().then(r => r.data),
                    client.supabase.from('player_stats').select('total_income').eq('player_id', victim.id).single().then(r => r.data),
                ]);

                // Safety: re-check victim balance
                const actualSteal = Math.min(stealAmount, freshVictim.total_income);
                if (actualSteal <= 0) {
                    return message.reply(`**${targetUser.username}** doesn't have enough money to steal anymore!`);
                }

                // Transfer (atomic RPCs)
                await Promise.all([
                    client.supabase.rpc('adjust_balance', { p_player_id: robber.id, p_amount: actualSteal }),
                    client.supabase.rpc('adjust_balance', { p_player_id: victim.id, p_amount: -actualSteal }),
                    trackTransaction(client.supabase, robber.id, 'steal_success', actualSteal, `Stole from ${targetUser.username}`),
                    trackTransaction(client.supabase, victim.id, 'steal_fail', actualSteal, `Robbed by ${message.author.username}`),
                ]);

                const embed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle('🔫 Robbery Successful!')
                    .setDescription(`${message.author} robbed **$${actualSteal.toLocaleString()}** from ${targetUser}!`)
                    .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                    .setFooter({ text: 'Crime pays... this time.' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });

            } else {
                // --- FAILURE ---
                // Apply 30-minute Discord timeout
                let timeoutApplied = false;
                try {
                    const member = await message.guild.members.fetch(message.author.id);
                    if (member && member.moderatable) {
                        await member.timeout(TIMEOUT_DURATION, 'Failed robbery attempt');
                        timeoutApplied = true;
                    }
                } catch (err) {
                    console.error('[Steal] Failed to apply timeout:', err.message);
                }

                // Track failed attempt
                await trackTransaction(client.supabase, robber.id, 'steal_fail', 0, `Failed robbery on ${targetUser.username}`);

                // Generate sarcastic AI message
                const sarcasticLine = await getSarcasticMessage(message.author.username);

                const embed = new EmbedBuilder()
                    .setColor(0xe74c3c)
                    .setTitle('🚨 Robbery Failed!')
                    .setDescription(
                        `${message.author} tried to rob ${targetUser} but got caught!\n\n` +
                        `> *"${sarcasticLine}"*` +
                        (timeoutApplied ? `\n\n🔇 **Timed out for 30 minutes!**` : '')
                    )
                    .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                    .setFooter({ text: 'Better luck next time, criminal.' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Error in steal command:', error);
            message.reply('An error occurred during the robbery.');
        }
    },
};
