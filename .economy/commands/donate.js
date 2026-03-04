import { EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

export default {
  name: 'donate',
  description: 'Donate money to the NMC company',
  async execute(message, args, client) {
    await message.channel.sendTyping(); // instant feedback
    if (args.length < 1) {
      return message.reply('Usage: ?donate <amount|all>');
    }

    let amount = 0;
    const isAll = args[0].toLowerCase() === 'all';

    if (!isAll) {
      amount = Math.floor(parseFloat(args[0]));
      if (isNaN(amount) || amount <= 0) {
        return message.reply('Please enter a valid amount.');
      }
    }

    try {
      // Get player
      const { data: player, error: playerError } = await client.supabase
        .from('players')
        .select('id')
        .eq('discord_id', message.author.id)
        .single();

      if (playerError || !player) {
        return message.reply('You are not registered in the economy system.');
      }

      // Get player stats
      const { data: stats, error: statsError } = await client.supabase
        .from('player_stats')
        .select('*')
        .eq('player_id', player.id)
        .single();

      if (statsError || !stats) {
        return message.reply('Could not fetch your balance.');
      }

      // Check balance
      // Check balance
      if (isAll) {
        amount = stats.total_income;
        if (amount <= 0) return message.reply('You have no money to donate!');
      }

      if (stats.total_income < amount) {
        return message.reply(`Insufficient balance! You need $${amount}, but you only have $${stats.total_income}.`);
      }

      // Execute transactions sequentially to prevent partial failure
      // 1. Deduct from player (atomic)
      await client.supabase.rpc('adjust_balance', { p_player_id: player.id, p_amount: -amount });

      // 2. Add to guild account (atomic)
      const { data: newGuildIncome } = await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: amount });

      // 3. Track donation transaction
      await trackTransaction(
        client.supabase,
        player.id,
        'donate',
        amount,
        `Donation to NMC company`
      );


      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setDescription(
          `Donation successful\n\n` +
          `Amount: **$${amount}**\n` +
          `Company Balance: **$${newGuildIncome}**`
        )
        .setFooter({
          text: message.guild.name,
          iconURL: message.guild.iconURL({ dynamic: true }),
        });

      message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      message.reply('An error occurred while processing your donation.');
    }
  },
};
