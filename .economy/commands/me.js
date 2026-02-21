import { getPlayerEconomyData } from '../utils/economyTracker.js';

export default {
  name: 'me',
  description: 'Shows your economy stats',
  async execute(message, args, client) {
    await message.channel.sendTyping(); // instant feedback
    const targetUser = message.mentions.users.first() || message.author;
    const userId = targetUser.id;
    const guildId = message.guildId;

    try {
      // 1. Get player (Need ID first)
      const { data: player, error: playerError } = await client.supabase
        .from('players')
        .select('id')
        .eq('discord_id', userId)
        .single();

      if (playerError || !player) {
        return message.reply(targetUser.id === message.author.id ? 'You are not registered in the economy system.' : 'That user is not registered.');
      }

      // 2. Parallel Fetch: Stats, Economy Data
      // This reduces sequential round-trips
      const [statsResult, economyData] = await Promise.all([
        // Fetch Stats
        client.supabase.from('player_stats').select('*').eq('player_id', player.id).single(),
        // Fetch Economy Data
        getPlayerEconomyData(client.supabase, player.id)
      ]);

      const stats = statsResult.data;
      if (statsResult.error || !stats) {
        return message.reply('Could not fetch stats.');
      }

      // Check if player should have donation role (only check for self to avoid abuse/spam checks on others)
      if (targetUser.id === message.author.id) {
        const guild = await client.guilds.fetch(guildId);
        const donationRole = guild.roles.cache.find(r => r.name === 'NMC Donor');
        if (economyData.total_donated >= 250000 && donationRole && !message.member.roles.cache.has(donationRole.id)) {
          await message.member.roles.add(donationRole);
        }
      }

      // Build embed
      const embed = {
        color: 0x00ff00,
        title: `${targetUser.username}'s Wallet`,
        thumbnail: {
          url: targetUser.displayAvatarURL({
            extension: 'png',
            size: 256,
            dynamic: true,
          }),
        },
        fields: [
          { name: '💰 Balance', value: `$${stats.total_income?.toLocaleString() || 0}`, inline: true },
          { name: '💸 Donated', value: `$${economyData.total_donated?.toLocaleString() || 0}`, inline: true },
          // Transfers removed as per request

          { name: '🎲 Won', value: `$${economyData.total_gambling_won?.toLocaleString() || 0}`, inline: true },
          { name: '📉 Lost', value: `$${economyData.total_gambling_lost?.toLocaleString() || 0}`, inline: true },
          { name: '🏛️ Tax Paid', value: `$${economyData.total_tax_paid?.toLocaleString() || 0}`, inline: true },
        ],
        timestamp: new Date(),
      };

      message.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      message.reply('An error occurred while fetching your stats.');
    }
  },
};
