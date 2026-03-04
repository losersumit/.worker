import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

export default {
  name: 'cf',
  description: 'Challenge another player or the Company (NMC) to a coin flip',
  async execute(message, args, client) {
    if (args[0] === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('Coinflip Rules')
        .addFields(
          { name: '🪙 How to Play', value: '`?cf <amount|all> <@user|nmc>`', inline: true },
          { name: '💰 Payouts', value: '**PVP**: Winner takes bet (10% fee)\n**PVE**: Standard 1:1', inline: true },
          { name: '📜 Mechanics', value: '• 50/50 Chance.\n• Heads or Tails.\n• Instant payout.', inline: false }
        )
        .setFooter({ text: 'Flip it to win it.' });
      return message.reply({ embeds: [embed] });
    }

    await message.channel.sendTyping(); // instant feedback
    if (args.length < 2) return message.reply('Usage: ?cf <amount|all> <@user | nmc>');

    let amount = Math.floor(parseFloat(args[0]));
    const isAllIn = args[0].toLowerCase() === 'all';

    const COMPANY_ID = process.env.COMPANY_ID || '1453737415318573280';
    const rawTarget = args[1].toLowerCase();

    // Determine target type
    let targetUser = message.mentions.users.first();
    let isCompany = false;

    if (rawTarget === 'nmc' || (targetUser && targetUser.id === COMPANY_ID)) {
      isCompany = true;
    }

    if (!isCompany && (!targetUser || targetUser.bot)) {
      // If it's a bot but NOT the company ID we expect, reject.
      // Assuming the ID provided by user is the "Company" bot.
      // If the user mentions THIS bot, we treat it as company.
      if (targetUser && targetUser.id === client.user.id) {
        isCompany = true;
      } else {
        return message.reply('Please mention a valid user or type "nmc" to play against the company.');
      }
    }

    // Initial validation if NOT all-in
    if (!isAllIn && (isNaN(amount) || amount <= 0)) return message.reply('Enter a valid amount.');
    if (!isCompany && targetUser.id === message.author.id) return message.reply('You cannot challenge yourself!');

    try {
      // Fetch challenger stats first to resolve "all"
      const { data: challenger } = await client.supabase.from('players').select('id').eq('discord_id', message.author.id).single();
      if (!challenger) return message.reply('You are not registered in the economy system.');

      const { data: cStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', challenger.id).single();

      if (isAllIn) {
        amount = cStats.total_income;
        if (amount <= 0) return message.reply('You have no money to bet!');
      }

      // Re-validate amount in case it was 0 or invalid after fetch
      if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');


      // 1. PVP LOGIC
      if (!isCompany) {
        // Fetch stats for target
        const { data: target } = await client.supabase.from('players').select('id').eq('discord_id', targetUser.id).single();

        if (!target) return message.reply('Target player is not registered.');

        const { data: tStats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', target.id).single();

        if (cStats.total_income < amount) return message.reply('You have insufficient balance.');
        if (tStats.total_income < amount) return message.reply('Target has insufficient balance.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('accept').setLabel('Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('reject').setLabel('Reject').setStyle(ButtonStyle.Danger)
        );

        const challengeMsg = await message.reply({
          content: `${targetUser}, ${message.author} challenged you to a coin flip for $${amount.toLocaleString()}!`,
          components: [row],
        });

        const collector = challengeMsg.createMessageComponentCollector({ time: 60000 });

        collector.on('collect', async (interaction) => {
          if (interaction.user.id !== targetUser.id) {
            return interaction.reply({ content: 'Not your challenge!', flags: MessageFlags.Ephemeral });
          }

          // Acknowledge and Disable Buttons
          await interaction.deferUpdate();
          await challengeMsg.edit({
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('acc').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
              new ButtonBuilder().setCustomId('rej').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
            )]
          });

          if (interaction.customId === 'reject') {
            await interaction.followUp(`${targetUser} rejected the challenge.`);
            return collector.stop();
          }

          // Output Flip UI
          await handleFlip(client, interaction, message.author, targetUser, amount, challenger, target, false);
          collector.stop();
        });

      } else {
        // 2. COMPANY (PVE) LOGIC

        if (cStats.total_income < amount) return message.reply('You have insufficient balance.');

        // Check Company Balance
        const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();

        // Ensure company can pay out 90% of the bet if they lose
        const maxPayout = amount * 0.9;
        const companyBalance = parseFloat(guild?.guild_income || 0);

        if (companyBalance < maxPayout) {
          return message.reply(`The Company (NMC) cannot afford this bet! Current Company Balance: $${Math.floor(companyBalance)}`);
        }

        // Direct to Flip UI
        // We simulate an interaction or just send a new message
        const choiceRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('heads').setLabel('Heads').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('tails').setLabel('Tails').setStyle(ButtonStyle.Primary)
        );

        const choiceMsg = await message.reply({
          content: `🏢 **Company Challenge!**\n${message.author}, playing against **NMC** for **$${amount.toLocaleString()}**.\nChoose Heads or Tails!`,
          components: [choiceRow]
        });

        // Use a helper specifically for PVE or reuse generic if adaptable.
        // Reusing logic is cleaner but parameters differ. Let's write inline or adaptation.
        const choiceCollector = choiceMsg.createMessageComponentCollector({ time: 30000 });

        choiceCollector.on('collect', async (choiceInt) => {
          try {
            if (choiceInt.user.id !== message.author.id) return choiceInt.reply({ content: 'Not your game!', flags: MessageFlags.Ephemeral });

            await choiceInt.deferUpdate();
            await choiceMsg.edit({
              components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('h').setLabel('Heads').setStyle(ButtonStyle.Primary).setDisabled(true),
                new ButtonBuilder().setCustomId('t').setLabel('Tails').setStyle(ButtonStyle.Primary).setDisabled(true)
              )]
            });

            const choice = choiceInt.customId;
            const flip = Math.random() < 0.5 ? 'heads' : 'tails';
            const won = choice === flip;

            // Re-fetch challenger stats to prevent exploit
            const { data: finalC } = await client.supabase.from('player_stats').select('total_income').eq('player_id', challenger.id).single();

            if (finalC.total_income < amount) {
              return choiceInt.followUp("❌ Request failed: insufficient balance at transaction time.");
            }

            let winnings = 0;
            let fee = 0;

            if (won) {
              fee = Math.floor(amount * 0.1);
              winnings = amount - fee;

              await client.supabase.rpc('adjust_balance', { p_player_id: challenger.id, p_amount: winnings });
              await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: -winnings });

              await trackTransaction(client.supabase, challenger.id, 'gamble_win', winnings, `Won flip vs Company`);

            } else {
              await client.supabase.rpc('adjust_balance', { p_player_id: challenger.id, p_amount: -amount });
              await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: amount });

              await trackTransaction(client.supabase, challenger.id, 'gamble_loss', amount, `Lost flip vs Company`);
            }

            const winnerText = won ? `${message.author} wins **$${winnings.toLocaleString()}**!` : `NMC wins! You lost **$${amount.toLocaleString()}**.`;
            await choiceInt.followUp(`🪙 Result: **${flip.toUpperCase()}**! ${winnerText}`);
            choiceCollector.stop();
          } catch (error) {
            console.error('Error in PVE Flip:', error);
            choiceInt.channel.send("An error occurred during the flip. Please check balances.");
            choiceCollector.stop();
          }
        });

      }
    } catch (err) {
      console.error(err);
      message.reply('An error occurred.');
    }
  },
};


/**
 * Shared Helper for PVP Flip Choice Phase
 * (Not used for PVE currently to keep logic distinct and simple above, but refactored from original code below)
 */
async function handleFlip(client, interaction, author, targetUser, amount, challenger, target, isCompany) {
  const choiceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('heads').setLabel('Heads').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('tails').setLabel('Tails').setStyle(ButtonStyle.Primary)
  );

  const choiceMsg = await interaction.followUp({
    content: `${targetUser}, choose Heads or Tails!`,
    components: [choiceRow],
    fetchReply: true
  });

  const choiceCollector = choiceMsg.createMessageComponentCollector({ time: 30000 });

  choiceCollector.on('collect', async (choiceInt) => {
    try {
      if (choiceInt.user.id !== targetUser.id) return choiceInt.reply({ content: 'Not your choice!', flags: MessageFlags.Ephemeral });

      await choiceInt.deferUpdate();
      await choiceMsg.edit({
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('h').setLabel('Heads').setStyle(ButtonStyle.Primary).setDisabled(true),
          new ButtonBuilder().setCustomId('t').setLabel('Tails').setStyle(ButtonStyle.Primary).setDisabled(true)
        )]
      });

      const choice = choiceInt.customId;
      const flip = Math.random() < 0.5 ? 'heads' : 'tails';
      const won = choice === flip;
      const fee = amount * 0.1;
      const winnings = amount - fee;

      // Re-fetch current balances for validation
      const { data: finalC } = await client.supabase.from('player_stats').select('total_income').eq('player_id', challenger.id).single();
      const { data: finalT } = await client.supabase.from('player_stats').select('total_income').eq('player_id', target.id).single();

      // Balance re-check — prevent going negative
      if (finalC.total_income < amount) {
        return choiceInt.followUp('❌ Challenger no longer has enough balance for this bet.');
      }
      if (finalT.total_income < amount) {
        return choiceInt.followUp('❌ Target no longer has enough balance for this bet.');
      }

      if (won) {
        await client.supabase.rpc('adjust_balance', { p_player_id: target.id, p_amount: winnings });
        await client.supabase.rpc('adjust_balance', { p_player_id: challenger.id, p_amount: -amount });
        await trackTransaction(client.supabase, target.id, 'gamble_win', winnings, `Won flip vs ${author.tag}`);
        await trackTransaction(client.supabase, challenger.id, 'gamble_loss', amount, `Lost flip vs ${targetUser.tag}`);
      } else {
        await client.supabase.rpc('adjust_balance', { p_player_id: challenger.id, p_amount: winnings });
        await client.supabase.rpc('adjust_balance', { p_player_id: target.id, p_amount: -amount });
        await trackTransaction(client.supabase, challenger.id, 'gamble_win', winnings, `Won flip vs ${targetUser.tag}`);
        await trackTransaction(client.supabase, target.id, 'gamble_loss', amount, `Lost flip vs ${author.tag}`);
      }

      // Guild Fee Logic for PVP (atomic)
      await client.supabase.rpc('adjust_guild_income', { p_guild_id: interaction.guildId, p_amount: fee });

      const winner = won ? targetUser : author;
      await choiceInt.followUp(`🪙 Result: **${flip.toUpperCase()}**! ${winner} wins **$${winnings.toLocaleString()}** (Fee: $${fee.toLocaleString()})`);
      choiceCollector.stop();
    } catch (e) {
      console.error('Error in PVP Flip:', e);
      choiceInt.channel.send("An error occurred during the flip. Please contact admin.");
      choiceCollector.stop();
    }
  });
}
