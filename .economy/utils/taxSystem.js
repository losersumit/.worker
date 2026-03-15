/**
 * Daily tax system - deducts 10% from all players and transfers to guild
 * Runs once per day at 12:00 AM server time
 */

import { trackTransaction } from './economyTracker.js';

async function applyDailyTax(client) {
  try {
    console.log('🏦 Applying daily 10% tax to players...');

    // Get all players with income
    const TARGET_GUILD_ID = process.env.GUILD_ID;

    const { data: players, error: playersError } = await client.supabase
      .from('player_stats')
      .select(`
    player_id,
    bank_balance,
    players!inner (
      guild_id
    )
  `)
      .gte('bank_balance', 5000)
      .eq('players.guild_id', TARGET_GUILD_ID);

    if (playersError) {
      console.error('Error fetching players:', playersError);
      return;
    }

    let totalTaxCollected = 0;

    for (const player of players) {
      // Tax only bank_balance — wallet (total_income) is untaxed
      const tax = Math.floor(player.bank_balance * 0.01);
      const newBankBalance = Math.floor(player.bank_balance - tax);

      await client.supabase
        .from('player_stats')
        .update({ bank_balance: newBankBalance })
        .eq('player_id', player.player_id);

      // Track tax payment in economy history/data
      await trackTransaction(client.supabase, player.player_id, 'tax', tax, 'Daily Tax');

      totalTaxCollected += tax;
    }

    // Update NMC company account (approved_guilds)
    const { data: guild, error: guildError } = await client.supabase
      .from('approved_guilds')
      .select('guild_id, guild_income')
      .eq('guild_id', process.env.GUILD_ID)
      .single();

    if (guildError || !guild) {
      console.error('Failed to fetch guild account');
      return;
    }

    const newGuildIncome =
      (parseFloat(guild.guild_income) || 0) + totalTaxCollected;

    await client.supabase
      .from('approved_guilds')
      .update({ guild_income: newGuildIncome })
      .eq('guild_id', guild.guild_id);

    console.log(`✅ Tax complete. Collected: €${totalTaxCollected}`);

    // Send embed summary
    const channelId = process.env.GENERAL_CHANNEL;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const embed = {
      color: 0x2ecc71,
      title: '🏦 Daily Tax Collected',
      fields: [
        {
          name: '💸 Total Tax Deducted',
          value: `€${totalTaxCollected.toFixed(2)}`,
          inline: true,
        },
        {
          name: '🏛️ NMC Company Balance',
          value: `€${newGuildIncome.toFixed(2)}`,
          inline: true,
        },
      ],
      footer: {
        text: 'Automatic daily tax at 12:00 AM',
      },
      timestamp: new Date(),
    };

    await channel.send({ embeds: [embed] });

  } catch (error) {
    console.error('Error applying daily tax:', error);
  }
}

export { applyDailyTax };
