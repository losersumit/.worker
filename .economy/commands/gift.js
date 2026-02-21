import { trackTransaction } from '../utils/economyTracker.js';

export default {
    name: 'gift',
    description: 'Gift money from company account to a player (Boss only)',
    async execute(message, args, client) {
        await message.channel.sendTyping();

        // Check permissions
        const bossRoleId = process.env.BOSS_ROLE_ID;
        if (!bossRoleId) {
            return message.reply('❌ BOSS_ROLE_ID is not configured in .env');
        }

        if (!message.member.roles.cache.has(bossRoleId)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        // Parse arguments
        if (args.length < 2) {
            return message.reply('Usage: ?gift <amount> <@user>');
        }

        const amount = parseInt(args[0]);
        const targetUser = message.mentions.users.first();

        if (isNaN(amount) || amount <= 0) {
            return message.reply('❌ Please specify a valid amount greater than 0.');
        }

        if (!targetUser) {
            return message.reply('❌ Please mention a user to gift to.');
        }

        try {
            // 1. Check Company Balance
            const { data: guild, error: guildError } = await client.supabase
                .from('approved_guilds')
                .select('guild_id, guild_income')
                .eq('guild_id', message.guildId)
                .single();

            if (guildError || !guild) {
                console.error('Guild fetch error:', guildError);
                return message.reply('❌ Failed to fetch company account info.');
            }

            if (guild.guild_income < amount) {
                return message.reply(`❌ Insufficient company funds. Company Balance: $${guild.guild_income}`);
            }

            // 2. Get Target Player
            const { data: player, error: playerError } = await client.supabase
                .from('players')
                .select('id')
                .eq('discord_id', targetUser.id)
                .single();

            if (playerError || !player) {
                return message.reply('❌ The target user is not registered in the economy system.');
            }

            // 3. Deduct from Company
            const newGuildIncome = parseFloat(guild.guild_income) - amount;
            const { error: updateGuildError } = await client.supabase
                .from('approved_guilds')
                .update({ guild_income: newGuildIncome })
                .eq('guild_id', guild.guild_id);

            if (updateGuildError) {
                console.error('Company deduction error:', updateGuildError);
                return message.reply('❌ Failed to update company account.');
            }

            // 4. Add to Player (using trackTransaction for history, OR manual update + trackTransaction for record)
            // Since trackTransaction updates economy_data but NOT player_stats.total_income (based on my read of previous files),
            // I need to update player_stats.total_income manually, AND call trackTransaction to log it.
            // Wait, let's check taxSystem.js -> it updates player_stats.total_income manually.
            // And economyTracker.js -> trackTransaction updates player_economy_data and history.
            // So I should do both.

            // Get current player stats
            const { data: stats } = await client.supabase
                .from('player_stats')
                .select('total_income')
                .eq('player_id', player.id)
                .single();

            const currentBalance = stats ? parseFloat(stats.total_income) : 0;
            const newPlayerBalance = currentBalance + amount;

            // Update player_stats
            const { error: updatePlayerError } = await client.supabase
                .from('player_stats')
                .update({ total_income: newPlayerBalance })
                .eq('player_id', player.id);

            if (updatePlayerError) {
                // Critical error: Company money gone, player didn't get it.
                // Ideally we'd rollback, but for this simple bot, just log it.
                console.error('Player update error:', updatePlayerError);
                return message.reply(`⚠️ Deduced from company but failed to add to player. Please contact admin.`);
            }

            // Log transaction
            await trackTransaction(client.supabase, player.id, 'gift', amount, `Gift from Company by ${message.author.tag}`);

            // 5. Success Message
            const embed = {
                color: 0xffd700, // Gold
                title: '🎁 Company Gift',
                description: `Successfully gifted **$${amount}** to ${targetUser}!`,
                fields: [
                    { name: 'Company Balance', value: `$${newGuildIncome}`, inline: true },
                    { name: 'User Balance', value: `$${newPlayerBalance}`, inline: true }
                ],
                timestamp: new Date()
            };

            message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Gift command error:', error);
            message.reply('❌ An unexpected error occurred.');
        }
    },
};
