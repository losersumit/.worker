import { EmbedBuilder } from 'discord.js';

export default {
  name: 'gamestats',
  description: 'Shows game statistics for a user',
  async execute(message, args, client) {
    await message.channel.sendTyping();

    try {
      // Find the target user and member
      let targetMember = message.mentions.members?.first() || message.member;
      let targetUser = targetMember?.user || message.author;

      const { data: player } = await client.supabase
        .from('players')
        .select('id')
        .eq('discord_id', targetUser.id)
        .maybeSingle();

      const displayName = targetMember?.displayName || targetUser.username;

      if (!player) {
        const errorMsg = targetUser.id === message.author.id
          ? '❌ You are not registered in the UVS system yet. Post a job log first!'
          : `❌ ${displayName} is not registered in the UVS system yet.`;
        return message.reply(errorMsg);
      }

      // Fetch all economy history at once
      const { data: history } = await client.supabase
        .from('player_economy_history')
        .select('transaction_type, amount, details')
        .eq('player_id', player.id);

      // ─── Coinflip Stats ───
      let cfWon = 0, cfLost = 0, cfWins = 0, cfLosses = 0;
      // ─── Russian Roulette Stats ───
      let rrWon = 0, rrLost = 0, rrWins = 0, rrLosses = 0, rrTimeMs = 0;
      // ─── Slot Stats ───
      let slotWon = 0, slotLost = 0, slotWins = 0, slotLosses = 0, slotJackpots = 0;
      // ─── Roulette Stats ───
      let rlWon = 0, rlLost = 0, rlWins = 0, rlLosses = 0;

      for (const h of history || []) {
        const amt = parseFloat(h.amount);
        const details = (h.details || '').toLowerCase();
        const isWin = h.transaction_type === 'gamble_win';
        const isLoss = h.transaction_type === 'gamble_loss';

        if (details.includes('flip')) {
          if (isWin) { cfWon += amt; cfWins++; }
          else if (isLoss) { cfLost += amt; cfLosses++; }
        } else if (details.includes('russian roulette')) {
          if (isWin) { rrWon += amt; rrWins++; }
          else if (isLoss) {
            rrLost += amt; rrLosses++;
            if (amt < 10000) rrTimeMs += 30 * 60 * 1000;
            else if (amt < 50000) rrTimeMs += 2 * 60 * 60 * 1000;
            else rrTimeMs += 4 * 60 * 60 * 1000;
          }
        } else if (details.includes('slot')) {
          if (isWin) {
            slotWon += amt; slotWins++;
            if (details.includes('triple')) slotJackpots++;
          }
          else if (isLoss) { slotLost += amt; slotLosses++; }
        } else if (details.includes('roulette')) {
          if (isWin) { rlWon += amt; rlWins++; }
          else if (isLoss) { rlLost += amt; rlLosses++; }
        }
      }

      const pct = (w, l) => {
        const total = w + l;
        return total > 0 ? ((w / total) * 100).toFixed(1) : '0.0';
      };

      // Format RR timeout duration
      let rrTimeout = '0m';
      if (rrTimeMs > 0) {
        const h = Math.floor(rrTimeMs / (1000 * 60 * 60));
        const m = Math.floor((rrTimeMs % (1000 * 60 * 60)) / (1000 * 60));
        rrTimeout = h > 0 ? `${h}h ${m}m` : `${m}m`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle(`📊 Game Statistics: ${displayName}`)
        .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          {
            name: '🪙 Coinflip',
            value:
              `Games: **${cfWins + cfLosses}** ┃ Win Rate: **${pct(cfWins, cfLosses)}%**\n` +
              `Won: **€${cfWon.toLocaleString()}** ┃ Lost: **€${cfLost.toLocaleString()}** ┃ Net: **€${(cfWon - cfLost).toLocaleString()}**`,
            inline: false
          },
          {
            name: '🔫 Russian Roulette',
            value:
              `Games: **${rrWins + rrLosses}** ┃ Win Rate: **${pct(rrWins, rrLosses)}%**\n` +
              `Won: **€${rrWon.toLocaleString()}** ┃ Lost: **€${rrLost.toLocaleString()}** ┃ Net: **€${(rrWon - rrLost).toLocaleString()}**\n` +
              `Deaths: **${rrLosses}** ┃ Timeout Served: **${rrTimeout}**`,
            inline: false
          },
          {
            name: '🎰 Slots',
            value:
              `Spins: **${slotWins + slotLosses}** ┃ Win Rate: **${pct(slotWins, slotLosses)}%**\n` +
              `Won: **€${slotWon.toLocaleString()}** ┃ Lost: **€${slotLost.toLocaleString()}** ┃ Net: **€${(slotWon - slotLost).toLocaleString()}**\n` +
              `Jackpots: **${slotJackpots}** ┃ Regular Wins: **${slotWins - slotJackpots}**`,
            inline: false
          },
          {
            name: '🎡 Roulette',
            value:
              `Rounds: **${rlWins + rlLosses}** ┃ Win Rate: **${pct(rlWins, rlLosses)}%**\n` +
              `Won: **€${rlWon.toLocaleString()}** ┃ Lost: **€${rlLost.toLocaleString()}** ┃ Net: **€${(rlWon - rlLost).toLocaleString()}**`,
            inline: false
          }
        )
        .setFooter({ text: 'NMC Economy • All-time stats' })
        .setTimestamp();

      return message.reply({ embeds: [embed] });

    } catch (err) {
      console.error('Error fetching game stats:', err);
      return message.reply('Failed to load stats.');
    }
  },
};
