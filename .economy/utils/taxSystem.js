/**
 * Daily tax system - deducts 1% from all player wallets and transfers to guild
 * Runs once per day at 12:00 AM server time
 */

import { trackTransaction } from './economyTracker.js';

async function applyDailyTax(client) {
  try {
    console.log('🏦 Applying daily 1% tax to player wallets...');

    const TARGET_GUILD_ID = process.env.GUILD_ID;
    const ENLISTED_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1482386008376086598';

    const guildObj = await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null);
    if (!guildObj) {
      console.error(`[TAX] Target guild ${TARGET_GUILD_ID} not found or inaccessible.`);
      return;
    }

    const { data: players, error: playersError } = await client.supabase
      .from('player_stats')
      .select(`
    player_id,
    wallet,
    players!inner (
      discord_id,
      guild_id
    )
  `)
      .gte('wallet', 5000)
      .eq('players.guild_id', TARGET_GUILD_ID);

    if (playersError) {
      console.error('Error fetching players:', playersError);
      return;
    }

    let totalTaxCollected = 0;

    for (const player of players) {
      const discordId = player.players?.discord_id;
      if (!discordId) continue;

      // Check if the player has the Enlisted role in the guild
      const member = await guildObj.members.fetch(discordId).catch(() => null);
      if (!member || !member.roles.cache.has(ENLISTED_ROLE_ID)) {
        continue; // Skip taxing if member does not have the Enlisted role
      }

      const tax = Math.floor(player.wallet * 0.01);
      const newWallet = Math.floor(player.wallet - tax);

      await client.supabase
        .from('player_stats')
        .update({ wallet: newWallet })
        .eq('player_id', player.player_id);

      // Track tax payment in economy history/data
      await trackTransaction(client, player.player_id, 'tax', tax, 'Daily Tax');

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
