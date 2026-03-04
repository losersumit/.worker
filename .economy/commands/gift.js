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

            // 3. Deduct from Company (atomic)
            const { data: newGuildIncome, error: rpcGuildError } = await client.supabase
                .rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: -amount });

            if (rpcGuildError) {
                console.error('Company deduction error:', rpcGuildError);
                return message.reply('❌ Failed to update company account.');
            }

            // 4. Add to Player (atomic)
            const { data: newPlayerBalance, error: rpcPlayerError } = await client.supabase
                .rpc('adjust_balance', { p_player_id: player.id, p_amount: amount });

            if (rpcPlayerError) {
                // Critical: Company money gone, player didn't get it. Attempt rollback.
                console.error('Player update error:', rpcPlayerError);
                await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: amount }).catch(() => { });
                return message.reply(`⚠️ Deducted from company but failed to add to player. Attempted rollback. Please contact admin.`);
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
