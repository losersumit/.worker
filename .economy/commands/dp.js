import { EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

export default {
    name: 'dp',
    description: 'Deposit money into your bank account',
    async execute(message, args, client) {
        await message.channel.sendTyping();

        if (!args[0]) {
            return message.reply('Usage: `?dp <amount|all>` — Deposit money into your bank.');
        }

        try {
            // 1. Get player
            const { data: player, error: playerError } = await client.supabase
                .from('players')
                .select('id')
                .eq('discord_id', message.author.id)
                .single();

            if (playerError || !player) {
                return message.reply('You are not registered in the economy system.');
            }

            // 2. Get current stats
            const { data: stats, error: statsError } = await client.supabase
                .from('player_stats')
                .select('total_income, bank_balance')
                .eq('player_id', player.id)
                .single();

            if (statsError || !stats) {
                return message.reply('Could not fetch your balance.');
            }

            const currentWallet = stats.total_income || 0;
            const currentBank = stats.bank_balance || 0;

            // 3. Parse amount
            let amount = 0;
            if (args[0].toLowerCase() === 'all') {
                amount = currentWallet;
            } else {
                amount = Math.floor(parseFloat(args[0]));
            }

            if (isNaN(amount) || amount <= 0) {
                return message.reply('Enter a valid amount to deposit.');
            }

            if (currentWallet < amount) {
                return message.reply(`Insufficient wallet balance! You have **$${currentWallet.toLocaleString()}** in your wallet.`);
            }

            // 4. Update balances (convert to integer for int8 columns)
            const newWallet = Math.floor(currentWallet - amount);
            const newBank = Math.floor(currentBank + amount);

            await client.supabase
                .from('player_stats')
                .update({ total_income: newWallet, bank_balance: newBank })
                .eq('player_id', player.id);

            // 5. Track transaction
            await trackTransaction(client.supabase, player.id, 'deposit', amount, `Deposited $${amount} to bank`);

            // 6. Confirmation embed
            const embed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle('🏦 Deposit Successful')
                .setDescription(`You deposited **$${amount.toLocaleString()}** into your bank.`)
                .addFields(
                    { name: '💰 Wallet', value: `$${newWallet.toLocaleString()}`, inline: true },
                    { name: '🏦 Bank', value: `$${newBank.toLocaleString()}`, inline: true },
                )
                .setFooter({ text: 'Bank deposits are safe but taxed 10% daily.' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in deposit command:', error);
            message.reply('An error occurred while processing your deposit.');
        }
    },
};
