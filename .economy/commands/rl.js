import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

// --- Constants ---
const ROULETTE_IMG = 'https://cdn.discordapp.com/attachments/1464745553559687393/1471034895295053896/vector-realistic-casino-roulette-table-wheel-chips-top-view-isolated-green-background.png?ex=698d7781&is=698c2601&hm=ce262a71c66a2a11c1f85a380943780f979c93e0d1312eb317a9fd2dbdb10f57';
const SPINNING_GIF = 'https://cdn.discordapp.com/attachments/1455232294901121195/1471076088586174637/Untitled_design_2.gif?ex=698d9dde&is=698c4c5e&hm=7b0ee2462e6d17427a6b4314d8265ee2f5f591ccbb284e7734b7d9dfd741b47a';
const MAX_PLAYERS = 5;

// Red numbers on European roulette wheel
const RED_NUMS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

function getRouletteColor(num) {
    if (num === 0) return 'green';
    return RED_NUMS.includes(num) ? 'red' : 'black';
}

// All bet options available
const BET_OPTIONS = [
    { id: 'red', label: 'Red 🔴', style: ButtonStyle.Danger, row: 0 },
    { id: 'black', label: 'Black ⚫', style: ButtonStyle.Secondary, row: 0 },
    { id: 'even', label: 'Even', style: ButtonStyle.Primary, row: 0 },
    { id: 'odd', label: 'Odd', style: ButtonStyle.Primary, row: 0 },
    { id: '1-18', label: '1-18', style: ButtonStyle.Success, row: 1 },
    { id: '19-36', label: '19-36', style: ButtonStyle.Success, row: 1 },
    { id: '1st 12', label: '1st 12', style: ButtonStyle.Secondary, row: 2 },
    { id: '2nd 12', label: '2nd 12', style: ButtonStyle.Secondary, row: 2 },
    { id: '3rd 12', label: '3rd 12', style: ButtonStyle.Secondary, row: 2 },
];

function doesBetWin(betId, resultNum) {
    const color = getRouletteColor(resultNum);
    switch (betId) {
        case 'red': return color === 'red';
        case 'black': return color === 'black';
        case 'even': return resultNum !== 0 && resultNum % 2 === 0;
        case 'odd': return resultNum !== 0 && resultNum % 2 !== 0;
        case '1-18': return resultNum >= 1 && resultNum <= 18;
        case '19-36': return resultNum >= 19 && resultNum <= 36;
        case '1st 12': return resultNum >= 1 && resultNum <= 12;
        case '2nd 12': return resultNum >= 13 && resultNum <= 24;
        case '3rd 12': return resultNum >= 25 && resultNum <= 36;
        default: return false;
    }
}

function formatBetChoices(choices) {
    return choices.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ');
}

// ========================================================================
// SUPABASE HELPERS — active_games table
// ========================================================================

async function createGame(supabase, guildId, channelId, ownerId, ownerPlayer) {
    const { data, error } = await supabase
        .from('active_games')
        .insert({
            guild_id: guildId,
            channel_id: channelId,
            owner_id: ownerId,
            game_type: 'roulette',
            status: 'lobby',
            pool: ownerPlayer.amount,
            company_contribution: ownerPlayer.amount, // company matches
            players: [ownerPlayer],
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

async function getGame(supabase, gameId) {
    const { data, error } = await supabase
        .from('active_games')
        .select('*')
        .eq('id', gameId)
        .single();
    if (error) throw error;
    return data;
}

async function updateGame(supabase, gameId, updates) {
    const { error } = await supabase
        .from('active_games')
        .update(updates)
        .eq('id', gameId);
    if (error) throw error;
}

// ========================================================================
// DEDUCTION / REFUND HELPERS
// ========================================================================

async function deductPlayerWallet(supabase, playerId, amount) {
    const { error } = await supabase.rpc('adjust_balance', { p_player_id: playerId, p_amount: -Math.floor(amount) });
    if (error) throw error;
}

async function addPlayerWallet(supabase, playerId, amount) {
    const { error } = await supabase.rpc('adjust_balance', { p_player_id: playerId, p_amount: Math.floor(amount) });
    if (error) throw error;
}

async function deductCompany(supabase, guildId, amount) {
    const { error } = await supabase.rpc('adjust_guild_income', { p_guild_id: guildId, p_amount: -Math.floor(amount) });
    if (error) throw error;
}

async function addCompany(supabase, guildId, amount) {
    const { error } = await supabase.rpc('adjust_guild_income', { p_guild_id: guildId, p_amount: Math.floor(amount) });
    if (error) throw error;
}

async function refundAll(supabase, guildId, game) {
    const players = game.players || [];
    for (const p of players) {
        await addPlayerWallet(supabase, p.player_id, p.amount);
    }
    if (game.status !== 'lobby' && game.company_contribution > 0) {
        await addCompany(supabase, guildId, game.company_contribution);
    }
    await updateGame(supabase, game.id, { status: 'cancelled' });
}

// ========================================================================
// UI BUILDERS
// ========================================================================

/**
 * Build UI components dynamically based on game state.
 */
function buildLobbyComponents(players, gameOwnerId, gameStarted = false) {
    // Top 3 rows are for bet selections
    const betRow1 = new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter(b => b.row === 0).map(b =>
            new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style).setDisabled(gameStarted)
        )
    );
    const betRow2 = new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter(b => b.row === 1).map(b =>
            new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style).setDisabled(gameStarted)
        )
    );
    const betRow3 = new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter(b => b.row === 2).map(b =>
            new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style).setDisabled(gameStarted)
        )
    );

    // Control row
    const allReady = players.every(p => p.ready && p.bets.length > 0);
    const atLeastOneWaiting = players.some(p => !p.ready);

    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('confirm_bets')
            .setLabel('✅ Confirm Bets')
            .setStyle(ButtonStyle.Success)
            .setDisabled(gameStarted),
        new ButtonBuilder()
            .setCustomId('add_bet')
            .setLabel('🎲 Add Bet')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(players.length >= MAX_PLAYERS || gameStarted),
        new ButtonBuilder()
            .setCustomId('start_game')
            .setLabel('🚀 Start Game')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!allReady || gameStarted || players.length === 0)
    );

    return [betRow1, betRow2, betRow3, controlRow];
}

function buildPoolEmbed(players, companyContribution, status) {
    const lines = players.map(p => {
        const choicesText = p.bets.length > 0
            ? ` → ${formatBetChoices(p.bets)}`
            : ' → *choosing bet...*';
        const readyMark = p.ready ? '✅' : '⏳';
        return `**${p.username}**: $${p.amount.toLocaleString()}${choicesText} ${readyMark}`;
    });

    const totalPool = players.reduce((sum, p) => sum + p.amount, 0) + companyContribution;

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`🎰 Multiplayer Roulette (Winner Takes All Pool)`)
        .setDescription(
            `**Total Pool: $${totalPool.toLocaleString()}**\n` +
            `🏢 Company Matches: $${companyContribution.toLocaleString()}\n\n` +
            `**Players:**\n${lines.join('\n')}\n\n` +
            `*${status}*`
        )
        .setImage(ROULETTE_IMG)
        .setFooter({ text: `Up to ${MAX_PLAYERS} players can join. Winners split the whole pool!` });

    return embed;
}

// ========================================================================
// MAIN EXPORT
// ========================================================================

export default {
    name: 'rl',
    description: 'Play Multiplayer Roulette (Parimutuel Pool)',
    async execute(message, args, client) {
        if (args[0] === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Roulette Help')
                .setDescription(
                    'Multiplayer Roulette Pool! Up to 5 players can join.\n' +
                    'The company matches all player bets to sweeten the pool.'
                )
                .addFields(
                    { name: '🎲 Usage', value: '\`?rl <amount|all>\` — Start a game', inline: false },
                    { name: '🎯 Bet Types', value: 'Red, Black, Even, Odd, 1-18, 19-36, 1st/2nd/3rd 12.\nYou can pick **multiple bets** — your money splits equally among them!', inline: false },
                    { name: '👥 Multiplayer flow', value: '1. Game owner starts it.\n2. ANYONE can click **Add Bet** to join.\n3. Everyone clicks bet options ON THE SAME MESSAGE.\n4. Click **Confirm Bets** when done.\n5. Game owner clicks **Start Game**.', inline: false },
                    { name: '💰 Parimutuel Payouts', value: 'The **entire pool** (player bets + company match) is strictly divided among the WINNING players proportionally to how much they wagered on the winning outcomes. If NO ONE hits a winning bet, the company takes the pool.', inline: false },
                )
                .setFooter({ text: 'Good luck!' });
            return message.reply({ embeds: [helpEmbed] });
        }

        if (!args[0]) return message.reply('Usage: \`?rl <amount|all>\` or \`?rl help\`');

        try {
            // --- 1. Validate Initiator ---
            const { data: player } = await client.supabase
                .from('players').select('id').eq('discord_id', message.author.id).single();
            if (!player) return message.reply('You are not registered in the economy system.');

            const { data: pStats } = await client.supabase
                .from('player_stats').select('total_income').eq('player_id', player.id).single();

            let amount = 0;
            if (args[0].toLowerCase() === 'all') {
                amount = pStats.total_income;
            } else {
                amount = Math.floor(parseFloat(args[0]));
            }

            if (isNaN(amount) || amount <= 0) return message.reply('Enter a valid amount.');
            if (pStats.total_income < amount) return message.reply('You have insufficient balance.');

            // Check company match
            const { data: guild } = await client.supabase
                .from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
            if (!guild) return message.reply('This server is not initialized for the economy system.');

            const companyBalance = parseFloat(guild.guild_income || 0);
            if (companyBalance < amount) {
                return message.reply(`The Company cannot afford to match your bet! Company Balance: $${Math.floor(companyBalance).toLocaleString()}`);
            }

            // --- 2. Upfront Deduction & Game Creation ---
            await deductPlayerWallet(client.supabase, player.id, amount);

            const ownerPlayer = {
                user_id: message.author.id,
                player_id: player.id,
                username: message.author.username,
                amount: amount,
                bets: [],
                ready: false,
            };

            const gameOwnerId = message.author.id;
            const game = await createGame(
                client.supabase,
                message.guildId,
                message.channel.id,
                gameOwnerId,
                ownerPlayer
            );

            // --- 3. Initial UI Layout ---
            const status = 'Waiting for players to choose bets...';
            const embed = buildPoolEmbed([ownerPlayer], amount, status);
            const components = buildLobbyComponents([ownerPlayer], gameOwnerId);

            const mainMsg = await message.reply({ embeds: [embed], components });

            // Run the Lobby Phase handler
            await runLobby(client, message, mainMsg, game.id, gameOwnerId);

        } catch (err) {
            console.error('[Roulette] Error starting:', err);
            message.reply('An error occurred while starting Roulette.');
        }
    },
};

// ========================================================================
// LOBBY PHASE
// ========================================================================

async function runLobby(client, message, mainMsg, gameId, gameOwnerId) {
    let gameStarted = false;
    const waitingForAmount = new Set();
    const lobbyCollector = mainMsg.createMessageComponentCollector({ time: 300000 }); // 5 min timeout

    lobbyCollector.on('collect', async (interaction) => {
        if (gameStarted) return;

        const id = interaction.customId;

        // Fetch fresh game state
        let game = await getGame(client.supabase, gameId);
        let players = game.players || [];

        // ------------------------------------------------------------
        // START GAME
        // ------------------------------------------------------------
        if (id === 'start_game') {
            if (interaction.user.id !== gameOwnerId) {
                return interaction.reply({ content: 'Only the game starter can start the game!', flags: MessageFlags.Ephemeral });
            }

            const allReady = players.every(p => p.ready && p.bets.length > 0);
            if (!allReady) {
                return interaction.reply({ content: 'All players must select bets and Confirm before starting.', flags: MessageFlags.Ephemeral });
            }

            gameStarted = true;
            lobbyCollector.stop('started');
            await interaction.deferUpdate();

            // Deduct company up front
            await deductCompany(client.supabase, message.guildId, game.company_contribution);
            await updateGame(client.supabase, gameId, { status: 'spinning' });

            await executeSpin(client, message, mainMsg, gameId);
            return;
        }

        // ------------------------------------------------------------
        // ADD BET (JOIN)
        // ------------------------------------------------------------
        if (id === 'add_bet') {
            if (players.find(p => p.user_id === interaction.user.id)) {
                return interaction.reply({ content: 'You are already in this game! Pick your bets on the embed above.', flags: MessageFlags.Ephemeral });
            }
            if (players.length >= MAX_PLAYERS) {
                return interaction.reply({ content: 'Game is full! (Max 5 players)', flags: MessageFlags.Ephemeral });
            }
            if (waitingForAmount.has(interaction.user.id)) {
                return interaction.reply({ content: 'You are already placing a bet! Type your amount in chat.', flags: MessageFlags.Ephemeral });
            }

            const { data: joinerPlayer } = await client.supabase
                .from('players').select('id').eq('discord_id', interaction.user.id).single();
            if (!joinerPlayer) {
                return interaction.reply({ content: 'You are not registered in the economy system.', flags: MessageFlags.Ephemeral });
            }

            await interaction.reply({ content: `${interaction.user}, type your **bet amount** in this channel:`, flags: MessageFlags.Ephemeral });
            waitingForAmount.add(interaction.user.id);

            const msgFilter = m => m.author.id === interaction.user.id && m.channel.id === message.channel.id;
            const msgCollector = message.channel.createMessageCollector({ filter: msgFilter, time: 30000, max: 1 });

            msgCollector.on('collect', async (amtMsg) => {
                waitingForAmount.delete(interaction.user.id);
                const rawAmt = amtMsg.content.trim().toLowerCase();
                try { await amtMsg.delete(); } catch (e) { /* ignore */ }

                const { data: jStats } = await client.supabase
                    .from('player_stats').select('total_income').eq('player_id', joinerPlayer.id).single();

                let joinAmount = rawAmt === 'all' ? (jStats?.total_income || 0) : Math.floor(parseFloat(rawAmt));

                if (isNaN(joinAmount) || joinAmount <= 0) {
                    return message.channel.send(`${interaction.user}, invalid amount.`).then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
                }
                if ((jStats?.total_income || 0) < joinAmount) {
                    return message.channel.send(`${interaction.user}, you don't have enough balance!`).then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
                }

                game = await getGame(client.supabase, gameId);
                players = game.players || [];

                const newCompanyContribution = game.company_contribution + joinAmount;
                const { data: freshGuild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
                const gBalance = parseFloat(freshGuild?.guild_income || 0);

                if (gBalance < newCompanyContribution) {
                    return message.channel.send(`${interaction.user}, the Company cannot afford to match! (Balance: $${gBalance})`).then(m => setTimeout(() => m.delete().catch(() => { }), 5000));
                }

                // Deduct Joiner
                await deductPlayerWallet(client.supabase, joinerPlayer.id, joinAmount);

                const newPlayer = {
                    user_id: interaction.user.id,
                    player_id: joinerPlayer.id,
                    username: interaction.user.username,
                    amount: joinAmount,
                    bets: [],
                    ready: false,
                };
                players.push(newPlayer);

                const newPool = game.pool + joinAmount;
                await updateGame(client.supabase, gameId, {
                    players: players,
                    pool: newPool,
                    company_contribution: newCompanyContribution,
                });

                const updatedEmbed = buildPoolEmbed(players, newCompanyContribution, 'Waiting for all players to choose bets...');
                await mainMsg.edit({ embeds: [updatedEmbed], components: buildLobbyComponents(players, gameOwnerId) });
            });

            msgCollector.on('end', (collected, reason) => {
                waitingForAmount.delete(interaction.user.id);
                if (reason === 'time' && collected.size === 0) {
                    interaction.followUp({ content: 'You took too long! Bet cancelled.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
            });
            return;
        }

        // ------------------------------------------------------------
        // CONFIRM BETS
        // ------------------------------------------------------------
        if (id === 'confirm_bets') {
            const playerIndex = players.findIndex(p => p.user_id === interaction.user.id);
            if (playerIndex === -1) {
                return interaction.reply({ content: 'You have not joined this game! Click **Add Bet** first.', flags: MessageFlags.Ephemeral });
            }

            const pInfo = players[playerIndex];
            if (pInfo.ready) {
                return interaction.reply({ content: 'You have already confirmed your bets.', flags: MessageFlags.Ephemeral });
            }
            if (pInfo.bets.length === 0) {
                return interaction.reply({ content: 'You must select at least one bet option before confirming.', flags: MessageFlags.Ephemeral });
            }

            players[playerIndex].ready = true;
            await updateGame(client.supabase, gameId, { players: players });
            await interaction.deferUpdate();

            const allReady = players.every(p => p.ready);
            const statusStr = allReady ? 'All players ready! The creator can start the game.' : 'Waiting for others to confirm bets...';

            const updatedEmbed = buildPoolEmbed(players, game.company_contribution, statusStr);
            await mainMsg.edit({ embeds: [updatedEmbed], components: buildLobbyComponents(players, gameOwnerId) });
            return;
        }

        // ------------------------------------------------------------
        // TOGGLE BET OPTIONS 
        // ------------------------------------------------------------
        // Any other button ID must be a bet option (red, black, 1st 12, etc)
        const validBetIds = BET_OPTIONS.map(b => b.id);
        if (validBetIds.includes(id)) {
            const playerIndex = players.findIndex(p => p.user_id === interaction.user.id);
            if (playerIndex === -1) {
                return interaction.reply({ content: 'You have not joined this game! Click **Add Bet** first.', flags: MessageFlags.Ephemeral });
            }

            const pInfo = players[playerIndex];
            if (pInfo.ready) {
                return interaction.reply({ content: 'You cannot change your bets after confirming!', flags: MessageFlags.Ephemeral });
            }

            const betIdx = pInfo.bets.indexOf(id);
            if (betIdx >= 0) {
                pInfo.bets.splice(betIdx, 1);
            } else {
                pInfo.bets.push(id);
            }

            await updateGame(client.supabase, gameId, { players: players });
            await interaction.deferUpdate();

            const updatedEmbed = buildPoolEmbed(players, game.company_contribution, 'Waiting for all players to choose bets...');
            // Keep components the same, just update embed
            await mainMsg.edit({ embeds: [updatedEmbed] });
            return;
        }
    });

    lobbyCollector.on('end', async (_, reason) => {
        if (reason === 'time' && !gameStarted) {
            try {
                const finalGame = await getGame(client.supabase, gameId);
                await refundAll(client.supabase, message.guildId, finalGame);
            } catch (e) { console.error('[Roulette] Timeout refund error:', e); }
            mainMsg.edit({ content: '⏱️ Game lobby timed out! All bets refunded.', embeds: [], components: [] }).catch(() => { });
        }
    });
}

// ========================================================================
// PARIMUTUEL PAYOUT / EXECUTION PHASE
// ========================================================================

async function executeSpin(client, message, mainMsg, gameId) {
    const game = await getGame(client.supabase, gameId);
    const players = game.players;
    const companyContribution = game.company_contribution;
    const totalPool = game.pool + companyContribution; // Entire pool to be split

    const spinEmbed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('🎰 Spinning the Wheel...')
        .setDescription(
            `**Total Pool: $${totalPool.toLocaleString()}** (Winner takes all!)\n\n` +
            players.map(p => `**${p.username}**: $${p.amount.toLocaleString()} → ${formatBetChoices(p.bets)}`).join('\n')
        )
        .setImage(SPINNING_GIF);

    await mainMsg.edit({ embeds: [spinEmbed], components: [] });

    setTimeout(async () => {
        try {
            const resultNum = Math.floor(Math.random() * 37); // 0-36
            const resultColor = getRouletteColor(resultNum);

            // 1. Identify winning parts for each player
            let sumOfWinningWagers = 0;

            const playerEvals = players.map(p => {
                const wagerPerSubBet = p.amount / p.bets.length; 
                const winningSubBets = p.bets.filter(b => doesBetWin(b, resultNum));
                const exactWinningWagerForPlayer = winningSubBets.length * wagerPerSubBet;
                
                sumOfWinningWagers += exactWinningWagerForPlayer;
                
                return {
                    ...p,
                    winningBets: winningSubBets,
                    losingBets: p.bets.filter(b => !winningSubBets.includes(b)),
                    exactWinningWagerForPlayer
                };
            });

            const resultLines = [];
            const updatePromises = [];
            let companyChange = -companyContribution; // By default they lost their matching contribution

            // 2. Distribute the Pool
            if (sumOfWinningWagers > 0) {
                // Someone won! Split the pool based on their proportion of the winning wager.
                let totalDispensed = 0;

                for (const p of playerEvals) {
                    if (p.exactWinningWagerForPlayer > 0) {
                        const winFraction = p.exactWinningWagerForPlayer / sumOfWinningWagers;
                        const payout = Math.floor(totalPool * winFraction);
                        totalDispensed += payout;

                        updatePromises.push(addPlayerWallet(client.supabase, p.player_id, payout));

                        const netProfit = payout - p.amount;
                        if (netProfit > 0) {
                            updatePromises.push(trackTransaction(client.supabase, p.player_id, 'gamble_win', netProfit, 'Won Parimutuel Roulette'));
                        } else if (netProfit < 0) {
                            // Rare: if they bet $10k on red and $10k on black to guarantee a win, but standard payout pool division doesn't cover their total $20k initial bet.
                            updatePromises.push(trackTransaction(client.supabase, p.player_id, 'gamble_loss', Math.abs(netProfit), 'Parimutuel Roulette Partial Loss'));
                        }

                        resultLines.push(`✅ **${p.username}** — payout **$${payout.toLocaleString()}** (Profit: ${netProfit >= 0 ? '+' : ''}$${netProfit.toLocaleString()})`);
                    } else {
                        // Complete loss for this player
                        updatePromises.push(trackTransaction(client.supabase, p.player_id, 'gamble_loss', p.amount, 'Lost Parimutuel Roulette'));
                        resultLines.push(`❌ **${p.username}** — lost **$${p.amount.toLocaleString()}**`);
                    }
                }
                
                // Any truncation remainder left directly in NMC's pocket (due to Math.floor)
                const leftovers = totalPool - totalDispensed; 
                if (leftovers > 0) {
                    updatePromises.push(addCompany(client.supabase, message.guildId, leftovers));
                    companyChange += leftovers;
                }
                
            } else {
                // No Winners — Company sweeps the entire pool
                for (const p of playerEvals) {
                    updatePromises.push(trackTransaction(client.supabase, p.player_id, 'gamble_loss', p.amount, 'Lost Parimutuel Roulette'));
                    resultLines.push(`❌ **${p.username}** — lost **$${p.amount.toLocaleString()}**`);
                }

                // Company regains its own contribution + keeps all players' money
                updatePromises.push(addCompany(client.supabase, message.guildId, totalPool));
                companyChange = totalPool - companyContribution; // Net profit is sum of player bets
            }

            await Promise.all(updatePromises);
            await updateGame(client.supabase, gameId, { status: 'completed', result: resultNum });

            const companyNetStr = companyChange >= 0 ? `+$${Math.floor(companyChange).toLocaleString()}` : `-$${Math.floor(Math.abs(companyChange)).toLocaleString()}`;

            const resultEmbed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('🎰 Roulette Result')
                .setDescription(
                    `**Final Outcome: ${resultNum} (${resultColor.toUpperCase()})**\n\n` +
                    resultLines.join('\n') +
                    `\n\n🏢 Company Net: ${companyNetStr}`
                )
                .setFooter({ text: 'Better luck next time!' })
                .setTimestamp();

            await mainMsg.edit({ embeds: [resultEmbed] });

        } catch (error) {
            console.error('[Roulette] Spin execution error:', error);
            mainMsg.edit({ content: 'An error occurred processing the spin.', embeds: [] }).catch(() => { });
        }
    }, 5500);
}
