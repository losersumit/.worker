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

      // Execute transactions in parallel
      const updatePromises = [];

      // Deduct from player account
      updatePromises.push((async () => {
        const newBalance = stats.total_income - amount;
        const { error: updateError } = await client.supabase
          .from('player_stats')
          .update({ total_income: newBalance })
          .eq('player_id', player.id);
        if (updateError) throw new Error('Failed to deduct funds');
      })());

      // Add to guild account
      updatePromises.push((async () => {
        const { data: guild, error: guildError } = await client.supabase
          .from('approved_guilds')
          .select('guild_income')
          .eq('guild_id', message.guildId)
          .single();

        if (!guildError && guild) {
          const newGuildIncome = (parseFloat(guild.guild_income) || 0) + amount;
          await client.supabase
            .from('approved_guilds')
            .update({ guild_income: newGuildIncome })
            .eq('guild_id', message.guildId);
          return newGuildIncome; // Return so we can use it in embed
        }
        return null; // In case guild is not found or error
      })());

      // Track donation transaction
      updatePromises.push(trackTransaction(
        client.supabase,
        player.id,
        'donate',
        amount,
        `Donation to NMC company`
      ));

      // Wait for all
      const results = await Promise.all(updatePromises);
      const newGuildIncome = results[1] || 'Updated'; // Get result from guild update promise


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
