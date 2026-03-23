import { EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

export default {
  name: 'transfer',
  description: 'Transfer money to another player',
  async execute(message, args, client) {
    await message.channel.sendTyping(); // instant feedback
    if (args.length < 2) {
      return message.reply('Usage: ?transfer <amount> <@user>');
    }

    const targetUser = message.mentions.users.first();
    const isAll = args[0].toLowerCase() === 'all';
    let amount = 0;

    if (!isAll) {
      amount = Math.floor(parseFloat(args[0]));
      if (isNaN(amount) || amount <= 0) {
        return message.reply('Please enter a valid amount.');
      }
    }

    if (!targetUser || targetUser.bot) {
      return message.reply('Please mention a valid user.');
    }

    if (targetUser.id === message.author.id) {
      return message.reply('You cannot transfer money to yourself!');
    }

    try {
      // Get sender
      const { data: sender, error: senderError } = await client.supabase
        .from('players')
        .select('id')
        .eq('discord_id', message.author.id)
        .single();

      if (senderError || !sender) {
        return message.reply('You are not registered in the economy system.');
      }

      // PARALLEL FETCH: Get Sender Stats + Receiver Receiver ID -> Receiver Stats
      // Validating IDs usually fast, but we can do parallel

      const [senderStatsResult, receiverResult] = await Promise.all([
        client.supabase.from('player_stats').select('wallet').eq('player_id', sender.id).single(),
        client.supabase.from('players').select('id').eq('discord_id', targetUser.id).single()
      ]);

      const senderStats = senderStatsResult.data;
      if (!senderStats) return message.reply('Could not fetch your balance.');

      if (isAll) {
        amount = senderStats.wallet;
        if (amount <= 0) return message.reply('You have no money to transfer!');
      }

      if (senderStats.wallet < amount) return message.reply(`Insufficient balance! You need €${amount}, but you only have €${senderStats.wallet}.`);

      const receiver = receiverResult.data;
      if (!receiver) return message.reply(`${targetUser.username} is not registered.`);

      // Sequential atomic updates to prevent partial failure
      // 1. Deduct from sender (atomic)
      await client.supabase.rpc('adjust_balance', { p_player_id: sender.id, p_amount: -amount });

      // 2. Add to receiver (atomic)
      await client.supabase.rpc('adjust_balance', { p_player_id: receiver.id, p_amount: amount });

      // 3. Track transaction
      await trackTransaction(client.supabase, sender.id, 'transfer', amount, `Transferred to ${targetUser.tag}`);


      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setDescription(
          `Transfer successful\n\n` +
          `Amount: **€${amount}**\n` +
          `To: ${targetUser}`
        )
        .setFooter({
          text: message.guild.name,
          iconURL: message.guild.iconURL({ dynamic: true }),
        });

      message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      message.reply('An error occurred while processing the transfer.');
    }
  },
};
