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

            // 2. Fetch all players in this guild with their balances
            const { data: allPlayers, error: topError } = await client.supabase
                .from('player_stats')
                .select(`
          total_income,
          bank_balance,
          players!inner (
            discord_id,
            guild_id
          )
        `)
                .eq('players.guild_id', guildId);

            if (topError) {
                console.error('Error fetching top players:', topError);
                return message.reply('Failed to fetch leaderboard data.');
            }

            // Compute total wealth and sort top 5
            const sorted = (allPlayers || [])
                .map(p => ({
                    ...p,
                    totalWealth: (p.total_income || 0) + (p.bank_balance || 0)
                }))
                .filter(p => p.totalWealth > 0)
                .sort((a, b) => b.totalWealth - a.totalWealth)
                .slice(0, 5);

            // 3. Build the leaderboard string
            const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
            let leaderboard = '';

            if (sorted.length > 0) {
                const lines = await Promise.all(
                    sorted.map(async (entry, i) => {
                        const discordId = entry.players.discord_id;
                        const wallet = (entry.total_income || 0).toLocaleString();
                        const bank = (entry.bank_balance || 0).toLocaleString();
                        const total = entry.totalWealth.toLocaleString();
                        try {
                            const user = await client.users.fetch(discordId);
                            return `${medals[i]} **${user.username}** — $${total}\n　　💰 $${wallet} ∙ 🏦 $${bank}`;
                        } catch {
                            return `${medals[i]} <@${discordId}> — $${total}\n　　💰 $${wallet} ∙ 🏦 $${bank}`;
                        }
                    })
                );
                leaderboard = lines.join('\n');
            } else {
                leaderboard = '*No players with any balance yet.*';
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
                        name: '🏆 Top 5 Richest (Total Wealth)',
                        value: leaderboard,
                        inline: false,
                    },
                ],
                footer: { text: 'Rankings based on wallet + bank balance' },
                timestamp: new Date(),
            };

            message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in guild command:', error);
            message.reply('An error occurred while fetching guild stats.');
        }
    },
};
