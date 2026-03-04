export default {
    name: 'guild',
    description: 'Shows guild income and the top 5 richest members by bank balance',
    async execute(message, args, client) {
        await message.channel.sendTyping();

        const guildId = message.guildId;

        try {
            // 1. Fetch guild (company) income
            const { data: guild, error: guildError } = await client.supabase
                .from('approved_guilds')
                .select('guild_income')
                .eq('guild_id', guildId)
                .single();

            if (guildError || !guild) {
                return message.reply('This guild is not registered in the economy system.');
            }

            // 2. Fetch top 5 richest players in this guild by bank_balance
            const { data: topPlayers, error: topError } = await client.supabase
                .from('player_stats')
                .select(`
          bank_balance,
          players!inner (
            discord_id,
            guild_id
          )
        `)
                .eq('players.guild_id', guildId)
                .gt('bank_balance', 0)
                .order('bank_balance', { ascending: false })
                .limit(5);

            if (topError) {
                console.error('Error fetching top players:', topError);
                return message.reply('Failed to fetch leaderboard data.');
            }

            // 3. Build the leaderboard string
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
            let leaderboard = '';

            if (topPlayers && topPlayers.length > 0) {
                const lines = await Promise.all(
                    topPlayers.map(async (entry, i) => {
                        const discordId = entry.players.discord_id;
                        try {
                            const user = await client.users.fetch(discordId);
                            return `${medals[i]} **${user.username}** — $${entry.bank_balance.toLocaleString()}`;
                        } catch {
                            return `${medals[i]} <@${discordId}> — $${entry.bank_balance.toLocaleString()}`;
                        }
                    })
                );
                leaderboard = lines.join('\n');
            } else {
                leaderboard = '*No players with bank balance yet.*';
            }

            // 4. Get the Discord guild name + icon
            const discordGuild = await client.guilds.fetch(guildId);

            // 5. Build embed
            const guildIncome = parseFloat(guild.guild_income) || 0;

            const embed = {
                color: 0xf1c40f,
                title: `🏛️ ${discordGuild.name} — Treasury`,
                thumbnail: {
                    url: discordGuild.iconURL({ extension: 'png', size: 256, dynamic: true }) || '',
                },
                fields: [
                    {
                        name: '💰 Company Balance',
                        value: `$${guildIncome.toLocaleString()}`,
                        inline: false,
                    },
                    {
                        name: '🏆 Top 5 Richest (Bank)',
                        value: leaderboard,
                        inline: false,
                    },
                ],
                footer: { text: 'Rankings based on bank balance' },
                timestamp: new Date(),
            };

            message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in guild command:', error);
            message.reply('An error occurred while fetching guild stats.');
        }
    },
};
