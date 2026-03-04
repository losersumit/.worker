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

function getBetMultiplier(betId) {
    if (['red', 'black', 'even', 'odd', '1-18', '19-36'].includes(betId)) return 2;
    if (['1st 12', '2nd 12', '3rd 12'].includes(betId)) return 3;
    return 2; // default
}

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

function buildBetButtons() {
    const row1 = new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter(b => b.row === 0).map(b =>
            new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style)
        )
    );
    const row2 = new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter(b => b.row === 1).map(b =>
            new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style)
        )
    );
    const row3 = new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter(b => b.row === 2).map(b =>
            new ButtonBuilder().setCustomId(b.id).setLabel(b.label).setStyle(b.style)
        )
    );
    return [row1, row2, row3];
}

/**
 * Build the pool embed showing all participants.
 * participants: Array of { user_id, username, amount, bets: string[] }
 * companyContribution: company's matching amount in the pool
 */
function buildPoolEmbed(participants, companyContribution, status = 'Waiting for players...') {
    const lines = participants.map(p => {
        const choicesText = p.bets.length > 0
            ? ` → ${formatBetChoices(p.bets)}`
            : ' → *choosing bet...*';
        return `**${p.username}**: $${p.amount.toLocaleString()}${choicesText}`;
    });

    const totalPool = participants.reduce((sum, p) => sum + p.amount, 0) + companyContribution;

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(`🎰 Multiplayer Roulette`)
        .setDescription(
            `**Pool: $${totalPool.toLocaleString()}**\n` +
            `🏢 Company (NMC): $${companyContribution.toLocaleString()}\n\n` +
            `**Players:**\n${lines.join('\n')}\n\n` +
            `*${status}*`
        )
        .setImage(ROULETTE_IMG)
        .setFooter({ text: `Up to ${MAX_PLAYERS} players can join` });

    return embed;
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

async function deleteGame(supabase, gameId) {
    const { error } = await supabase
        .from('active_games')
        .delete()
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

// ========================================================================
// REFUND ALL — used on cancellation / timeout
// ========================================================================

async function refundAll(supabase, guildId, game) {
    const players = game.players || [];
    // Refund each player
    for (const p of players) {
        await addPlayerWallet(supabase, p.player_id, p.amount);
    }
    // Only refund company if it was actually charged (status moved past 'lobby')
    if (game.status !== 'lobby' && game.company_contribution > 0) {
        await addCompany(supabase, guildId, game.company_contribution);
    }
    // Mark game cancelled
    await updateGame(supabase, game.id, { status: 'cancelled' });
}

// ========================================================================
// MAIN EXPORT
// ========================================================================

export default {
    name: 'rl',
    description: 'Play Multiplayer Roulette',
    async execute(message, args, client) {
        // --- Help ---
        if (args[0] === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('Roulette Help')
                .setDescription(
                    'Multiplayer roulette! Up to 5 players can join a single game.\n' +
                    'The company matches all player bets into the pool.'
                )
                .addFields(
                    { name: '🎲 Usage', value: '`?rl <amount|all>` — Start a roulette game', inline: false },
                    { name: '🎯 Bet Types', value: 'Red/Black/Even/Odd/1-18/19-36 (x2)\n1st 12/2nd 12/3rd 12 (x3)\nYou can pick **multiple bets** — your money splits equally!', inline: false },
                    { name: '👥 Multiplayer', value: 'Others click **Add Bet**, type their amount, and choose bets.\nOnly the game starter can press **Start Game**.', inline: false },
                    { name: '💰 Payouts', value: 'Money is deducted **upfront**. Each winning sub-bet pays at its standard multiplier. Pool remainder goes to the company; deficit is covered by the company.', inline: false },
                )
                .setFooter({ text: 'Good luck!' });
            return message.reply({ embeds: [helpEmbed] });
        }

        if (!args[0]) return message.reply('Usage: `?rl <amount|all>` or `?rl help`');

        try {
            // --- 1. Fetch initiator data ---
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

            // Check company can match
            const { data: guild } = await client.supabase
                .from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
            if (!guild) return message.reply('This server is not initialized for the economy system.');

            const companyBalance = parseFloat(guild.guild_income || 0);
            if (companyBalance < amount) {
                return message.reply(`The Company (NMC) cannot afford to match your bet! Company Balance: $${Math.floor(companyBalance).toLocaleString()}`);
            }

            // --- 2. Show initial bet selection for owner ---
            const gameOwnerId = message.author.id;
            let ownerBettingPhase = true;

            const betRows = buildBetButtons();
            const doneRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('done_betting').setLabel('✅ Confirm Bets').setStyle(ButtonStyle.Success)
            );

            const initEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`🎰 Roulette | ${message.author.username}'s Game`)
                .setDescription(
                    `**${message.author.username}**, choose your bet(s)!\n` +
                    `Your Amount: **$${amount.toLocaleString()}**\n\n` +
                    `Click multiple bet buttons to split your money equally across them.\n` +
                    `Press **Confirm Bets** when done.`
                )
                .setImage(ROULETTE_IMG)
                .setFooter({ text: 'Select your bets, then confirm.' });

            const mainMsg = await message.reply({
                embeds: [initEmbed],
                components: [...betRows, doneRow]
            });

            // --- Owner bet selection phase ---
            const ownerBets = [];
            const ownerCollector = mainMsg.createMessageComponentCollector({ time: 60000 });

            ownerCollector.on('collect', async (interaction) => {
                if (interaction.user.id !== gameOwnerId) {
                    return interaction.reply({ content: 'Wait for the game owner to finish setting up!', flags: MessageFlags.Ephemeral });
                }

                const id = interaction.customId;

                if (id === 'done_betting') {
                    if (ownerBets.length === 0) {
                        return interaction.reply({ content: 'You need to select at least one bet!', flags: MessageFlags.Ephemeral });
                    }
                    ownerBettingPhase = false;
                    ownerCollector.stop('done');
                    await interaction.deferUpdate();
                    return;
                }

                // Toggle bet selection
                const existing = ownerBets.indexOf(id);
                if (existing >= 0) {
                    ownerBets.splice(existing, 1);
                } else {
                    ownerBets.push(id);
                }

                // Update embed to show selected bets
                const selectedText = ownerBets.length > 0
                    ? `Selected: **${formatBetChoices(ownerBets)}**`
                    : 'No bets selected yet.';

                const updatedEmbed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle(`🎰 Roulette | ${message.author.username}'s Game`)
                    .setDescription(
                        `**${message.author.username}**, choose your bet(s)!\n` +
                        `Your Amount: **$${amount.toLocaleString()}**\n\n` +
                        `${selectedText}\n` +
                        `Your money will be split equally across selected bets.\n` +
                        `Press **Confirm Bets** when done.`
                    )
                    .setImage(ROULETTE_IMG)
                    .setFooter({ text: 'Select your bets, then confirm.' });

                await interaction.update({ embeds: [updatedEmbed] });
            });

            ownerCollector.on('end', async (_, reason) => {
                if (reason === 'time' && ownerBettingPhase) {
                    await mainMsg.edit({ content: '⏱️ Timed out! Game cancelled.', embeds: [], components: [] });
                    return;
                }

                if (reason !== 'done') return;

                try {
                    // --- UPFRONT DEDUCTION: owner ---
                    await deductPlayerWallet(client.supabase, player.id, amount);

                    // --- Create game in Supabase ---
                    const ownerPlayer = {
                        user_id: message.author.id,
                        player_id: player.id,
                        username: message.author.username,
                        amount: amount,
                        bets: [...ownerBets],
                        ready: true,
                    };

                    const game = await createGame(
                        client.supabase,
                        message.guildId,
                        message.channel.id,
                        gameOwnerId,
                        ownerPlayer
                    );

                    // --- Lobby Phase ---
                    await startLobby(client, message, mainMsg, game.id, gameOwnerId);
                } catch (err) {
                    console.error('[Roulette] Error creating game:', err);
                    // Attempt to refund the owner
                    try { await addPlayerWallet(client.supabase, player.id, amount); } catch (e) { /* best effort */ }
                    await mainMsg.edit({ content: '❌ An error occurred while creating the game. Your bet has been refunded.', embeds: [], components: [] });
                }
            });

        } catch (err) {
            console.error('[Roulette] Error:', err);
            message.reply('An error occurred while starting Roulette.');
        }
    },
};

// ========================================================================
// LOBBY PHASE — Add Bet / Start Game
// ========================================================================
async function startLobby(client, message, mainMsg, gameId, gameOwnerId) {
    let gameStarted = false;

    // Active "waiting for amount" users
    const waitingForAmount = new Set();

    function buildLobbyComponents(players) {
        const allReady = players.every(p => p.ready);
        const lobbyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('add_bet')
                .setLabel('🎲 Add Bet')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(players.length >= MAX_PLAYERS || gameStarted),
            new ButtonBuilder()
                .setCustomId('start_game')
                .setLabel('🚀 Start Game')
                .setStyle(ButtonStyle.Success)
                .setDisabled(!allReady || gameStarted)
        );
        return [lobbyRow];
    }

    // Fetch fresh game state
    let game = await getGame(client.supabase, gameId);
    let players = game.players;

    const poolEmbed = buildPoolEmbed(players, game.company_contribution,
        players.length < 2
            ? 'Waiting for players to join... or start solo!'
            : 'Waiting for all players to choose bets...'
    );
    await mainMsg.edit({ embeds: [poolEmbed], components: buildLobbyComponents(players) });

    const lobbyCollector = mainMsg.createMessageComponentCollector({ time: 300000 }); // 5 min

    lobbyCollector.on('collect', async (interaction) => {
        if (gameStarted) return;

        const id = interaction.customId;

        // --- ADD BET ---
        if (id === 'add_bet') {
            // Refresh game state
            game = await getGame(client.supabase, gameId);
            players = game.players;

            // Check if already in the game
            if (players.find(p => p.user_id === interaction.user.id)) {
                return interaction.reply({ content: 'You are already in this game!', flags: MessageFlags.Ephemeral });
            }
            if (players.length >= MAX_PLAYERS) {
                return interaction.reply({ content: 'Game is full! (Max 5 players)', flags: MessageFlags.Ephemeral });
            }
            if (waitingForAmount.has(interaction.user.id)) {
                return interaction.reply({ content: 'You are already placing a bet! Type your amount in chat.', flags: MessageFlags.Ephemeral });
            }

            // Check if user is registered
            const { data: joinerPlayer } = await client.supabase
                .from('players').select('id').eq('discord_id', interaction.user.id).single();
            if (!joinerPlayer) {
                return interaction.reply({ content: 'You are not registered in the economy system.', flags: MessageFlags.Ephemeral });
            }

            await interaction.reply({ content: `${interaction.user}, type your **bet amount** in this channel:`, flags: MessageFlags.Ephemeral });

            waitingForAmount.add(interaction.user.id);

            // Listen for their next message in this channel
            const msgFilter = m => m.author.id === interaction.user.id && m.channel.id === message.channel.id;
            const msgCollector = message.channel.createMessageCollector({ filter: msgFilter, time: 30000, max: 1 });

            msgCollector.on('collect', async (amtMsg) => {
                waitingForAmount.delete(interaction.user.id);

                const rawAmt = amtMsg.content.trim().toLowerCase();

                // Delete the user's amount message
                try { await amtMsg.delete(); } catch (e) { /* ignore */ }

                // Fetch their balance
                const { data: jStats } = await client.supabase
                    .from('player_stats').select('total_income').eq('player_id', joinerPlayer.id).single();

                let joinAmount = 0;
                if (rawAmt === 'all') {
                    joinAmount = jStats?.total_income || 0;
                } else {
                    joinAmount = Math.floor(parseFloat(rawAmt));
                }

                if (isNaN(joinAmount) || joinAmount <= 0) {
                    try {
                        const errMsg = await message.channel.send(`${interaction.user}, invalid amount! Your bet was cancelled.`);
                        setTimeout(() => errMsg.delete().catch(() => { }), 5000);
                    } catch (e) { /* ignore */ }
                    return;
                }

                if ((jStats?.total_income || 0) < joinAmount) {
                    try {
                        const errMsg = await message.channel.send(`${interaction.user}, you don't have enough! You need $${joinAmount.toLocaleString()}.`);
                        setTimeout(() => errMsg.delete().catch(() => { }), 5000);
                    } catch (e) { /* ignore */ }
                    return;
                }

                // Refresh game to get latest company_contribution
                game = await getGame(client.supabase, gameId);
                players = game.players;

                // Check company can match this new bet too
                const newCompanyContribution = game.company_contribution + joinAmount;
                const { data: freshGuild } = await client.supabase
                    .from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
                const gBalance = parseFloat(freshGuild?.guild_income || 0);

                if (gBalance < newCompanyContribution) {
                    try {
                        const errMsg = await message.channel.send(`${interaction.user}, the Company cannot afford to match! Bet cancelled.`);
                        setTimeout(() => errMsg.delete().catch(() => { }), 5000);
                    } catch (e) { /* ignore */ }
                    return;
                }

                // --- UPFRONT DEDUCTION: joiner ---
                await deductPlayerWallet(client.supabase, joinerPlayer.id, joinAmount);

                // Add participant to game (not ready yet — needs to pick bets)
                const newPlayer = {
                    user_id: interaction.user.id,
                    player_id: joinerPlayer.id,
                    username: interaction.user.username,
                    amount: joinAmount,
                    bets: [],
                    ready: false,
                };
                players.push(newPlayer);

                // Update game in Supabase
                const newPool = game.pool + joinAmount;
                await updateGame(client.supabase, gameId, {
                    players: players,
                    pool: newPool,
                    company_contribution: newCompanyContribution,
                });

                game.pool = newPool;
                game.company_contribution = newCompanyContribution;

                // Update pool embed
                const updatedEmbed = buildPoolEmbed(players, game.company_contribution, 'Waiting for all players to choose bets...');
                await mainMsg.edit({ embeds: [updatedEmbed], components: buildLobbyComponents(players) });

                // Show bet selection to this user
                await showBetSelection(client, message, mainMsg, interaction.user, gameId, gameOwnerId, buildLobbyComponents);
            });

            msgCollector.on('end', async (collected, reason) => {
                waitingForAmount.delete(interaction.user.id);
                if (reason === 'time' && collected.size === 0) {
                    interaction.followUp({ content: 'You took too long! Bet cancelled.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
            });

            return;
        }

        // --- START GAME ---
        if (id === 'start_game') {
            if (interaction.user.id !== gameOwnerId) {
                return interaction.reply({ content: 'Only the game starter can start the game!', flags: MessageFlags.Ephemeral });
            }

            // Refresh game state
            game = await getGame(client.supabase, gameId);
            players = game.players;

            const allReady = players.every(p => p.ready);
            if (!allReady) {
                return interaction.reply({ content: 'Not all players have chosen their bets yet!', flags: MessageFlags.Ephemeral });
            }

            gameStarted = true;
            await interaction.deferUpdate();
            lobbyCollector.stop('started');

            // --- UPFRONT DEDUCTION: company ---
            await deductCompany(client.supabase, message.guildId, game.company_contribution);

            // Update game status to spinning
            await updateGame(client.supabase, gameId, { status: 'spinning' });

            // Run the game!
            await runMultiplayerGame(client, message, mainMsg, gameId);
        }
    });

    lobbyCollector.on('end', async (_, reason) => {
        if (reason === 'time') {
            // Refund all players on timeout
            try {
                game = await getGame(client.supabase, gameId);
                await refundAll(client.supabase, message.guildId, game);
            } catch (e) {
                console.error('[Roulette] Error refunding on timeout:', e);
            }
            mainMsg.edit({ content: '⏱️ Game lobby timed out! All bets have been refunded.', embeds: [], components: [] }).catch(() => { });
        }
    });
}

// ========================================================================
// BET SELECTION FOR JOINING PLAYERS
// ========================================================================
async function showBetSelection(client, message, mainMsg, user, gameId, gameOwnerId, buildLobbyComponents) {
    const betRows = buildBetButtons();
    const doneRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`done_bet_${user.id}`).setLabel('✅ Confirm Bets').setStyle(ButtonStyle.Success)
    );

    const betMsg = await message.channel.send({
        content: `${user}, choose your bet(s) and press **Confirm Bets**:`,
        components: [...betRows, doneRow]
    });

    const userBets = [];
    const betCollector = betMsg.createMessageComponentCollector({ time: 60000 });

    betCollector.on('collect', async (interaction) => {
        if (interaction.user.id !== user.id) {
            return interaction.reply({ content: 'Not your bet selection!', flags: MessageFlags.Ephemeral });
        }

        const btnId = interaction.customId;

        if (btnId === `done_bet_${user.id}`) {
            if (userBets.length === 0) {
                return interaction.reply({ content: 'Select at least one bet!', flags: MessageFlags.Ephemeral });
            }

            // Update player in Supabase game
            let game = await getGame(client.supabase, gameId);
            let players = game.players;
            const participant = players.find(p => p.user_id === user.id);
            if (participant) {
                participant.bets = [...userBets];
                participant.ready = true;
                await updateGame(client.supabase, gameId, { players: players });
            }

            betCollector.stop('done');
            await interaction.deferUpdate();
            await betMsg.delete().catch(() => { });

            // Update main pool embed
            const allReady = players.every(p => p.ready);
            const status = allReady
                ? 'All players ready! Game starter can press Start Game.'
                : 'Waiting for all players to choose bets...';
            const updatedEmbed = buildPoolEmbed(players, game.company_contribution, status);
            await mainMsg.edit({ embeds: [updatedEmbed], components: buildLobbyComponents(players) });
            return;
        }

        // Toggle bet
        const existing = userBets.indexOf(btnId);
        if (existing >= 0) {
            userBets.splice(existing, 1);
        } else {
            userBets.push(btnId);
        }

        const selectedText = userBets.length > 0
            ? `Selected: **${formatBetChoices(userBets)}**`
            : 'No bets selected yet.';

        await interaction.update({
            content: `${user}, choose your bet(s):\n${selectedText}\nPress **Confirm Bets** when done.`,
        });
    });

    betCollector.on('end', async (_, reason) => {
        if (reason === 'time') {
            // Refund and remove participant if they didn't confirm
            let game = await getGame(client.supabase, gameId);
            let players = game.players;
            const idx = players.findIndex(p => p.user_id === user.id);
            if (idx >= 0 && !players[idx].ready) {
                const removedPlayer = players[idx];
                players.splice(idx, 1);

                // Refund the player
                await addPlayerWallet(client.supabase, removedPlayer.player_id, removedPlayer.amount);

                // Update game
                const newPool = game.pool - removedPlayer.amount;
                const newCompanyContribution = game.company_contribution - removedPlayer.amount;
                await updateGame(client.supabase, gameId, {
                    players: players,
                    pool: newPool,
                    company_contribution: newCompanyContribution,
                });

                const updatedEmbed = buildPoolEmbed(players, newCompanyContribution, 'A player timed out and was removed. Bet refunded.');
                await mainMsg.edit({ embeds: [updatedEmbed], components: buildLobbyComponents(players) }).catch(() => { });
            }
            await betMsg.delete().catch(() => { });
        }
    });
}

// ========================================================================
// GAME EXECUTION
// ========================================================================
async function runMultiplayerGame(client, message, mainMsg, gameId) {
    // Fetch final game state
    const game = await getGame(client.supabase, gameId);
    const players = game.players;
    const companyContribution = game.company_contribution;
    const pool = game.pool + companyContribution; // total pool = player bets + company match

    // 1. Show spinning embed
    const spinEmbed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('🎰 Spinning the Wheel...')
        .setDescription(
            players.map(p =>
                `**${p.username}**: $${p.amount.toLocaleString()} → ${formatBetChoices(p.bets)}`
            ).join('\n') +
            `\n\n🏢 Company Pool: $${companyContribution.toLocaleString()}` +
            `\n💰 Total Pool: $${pool.toLocaleString()}`
        )
        .setImage(SPINNING_GIF);

    await mainMsg.edit({ embeds: [spinEmbed], components: [] });

    // 2. Wait 5.5 seconds
    setTimeout(async () => {
        try {
            // 3. Generate result
            const resultNum = Math.floor(Math.random() * 37); // 0-36
            const resultColor = getRouletteColor(resultNum);

            // 4. Evaluate each player using STANDARD ROULETTE MULTIPLIERS
            // Each sub-bet pays at multiplier * subAmount on win
            const playerResults = players.map(p => {
                const perBetAmount = Math.floor(p.amount / p.bets.length);
                const winningBets = [];
                const losingBets = [];
                let totalReturn = 0;

                for (const bet of p.bets) {
                    if (doesBetWin(bet, resultNum)) {
                        winningBets.push(bet);
                        totalReturn += perBetAmount * getBetMultiplier(bet);
                    } else {
                        losingBets.push(bet);
                    }
                }

                return {
                    ...p,
                    perBetAmount,
                    winningBets,
                    losingBets,
                    totalReturn,
                };
            });

            // 5. Calculate total payouts and pool remainder
            const totalPayouts = playerResults.reduce((s, pr) => s + pr.totalReturn, 0);
            const poolRemainder = pool - totalPayouts;
            // poolRemainder > 0 → company profit, poolRemainder < 0 → company deficit

            // 6. Database updates — pay out winners, track transactions
            const updatePromises = [];
            const resultLines = [];

            for (const pr of playerResults) {
                if (pr.totalReturn > 0) {
                    // Player won something — add winnings to wallet
                    updatePromises.push((async () => {
                        await addPlayerWallet(client.supabase, pr.player_id, pr.totalReturn);
                        const net = pr.totalReturn - pr.amount;
                        if (net > 0) {
                            await trackTransaction(client.supabase, pr.player_id, 'gamble_win', net, 'Won Multiplayer Roulette');
                        } else if (net < 0) {
                            await trackTransaction(client.supabase, pr.player_id, 'gamble_loss', Math.abs(net), 'Partial loss Multiplayer Roulette');
                        }
                    })());

                    const net = pr.totalReturn - pr.amount;
                    if (net > 0) {
                        const wonBetsText = formatBetChoices(pr.winningBets);
                        const lostBetsText = pr.losingBets.length > 0 ? ` (Lost: ${formatBetChoices(pr.losingBets)})` : '';
                        resultLines.push(`✅ **${pr.username}** — Won: ${wonBetsText}${lostBetsText} — Profit: +$${net.toLocaleString()}`);
                    } else if (net === 0) {
                        resultLines.push(`➖ **${pr.username}** — Bet: ${formatBetChoices(pr.bets)} — Broke Even`);
                    } else {
                        const wonBetsText = pr.winningBets.length > 0 ? ` (Won: ${formatBetChoices(pr.winningBets)})` : '';
                        resultLines.push(`❌ **${pr.username}** — Bet: ${formatBetChoices(pr.bets)}${wonBetsText} — Lost: $${Math.abs(net).toLocaleString()}`);
                    }
                } else {
                    // Player lost everything — money already deducted upfront
                    updatePromises.push(
                        trackTransaction(client.supabase, pr.player_id, 'gamble_loss', pr.amount, 'Lost Multiplayer Roulette')
                    );
                    resultLines.push(`❌ **${pr.username}** — Bet: ${formatBetChoices(pr.bets)} — Lost: $${pr.amount.toLocaleString()}`);
                }
            }

            // 7. Settle company — pool remainder
            // The company already had company_contribution deducted.
            // poolRemainder = (playerBets + companyContribution) - totalPayouts
            // If positive: company gets the remainder back (profit)
            // If negative: company covers the deficit (extra loss)
            // If zero: company breaks even (already lost its contribution)
            updatePromises.push((async () => {
                if (poolRemainder > 0) {
                    // Company gets the remainder as profit
                    await addCompany(client.supabase, message.guildId, poolRemainder);
                } else if (poolRemainder < 0) {
                    // Company covers the deficit — deduct more from company
                    await deductCompany(client.supabase, message.guildId, Math.abs(poolRemainder));
                }
                // If exactly 0, company already lost its contribution, nothing to do
            })());

            await Promise.all(updatePromises);

            // 8. Update game as completed
            await updateGame(client.supabase, gameId, {
                status: 'completed',
                result: resultNum,
            });

            // 9. Company net for display
            // Company put in company_contribution. It gets back poolRemainder (if positive).
            // companyNet = poolRemainder - companyContribution (how much company gained/lost overall)
            // Actually: company deducted company_contribution upfront.
            //   If poolRemainder > 0, company gets poolRemainder back.
            //   So company net = poolRemainder - companyContribution
            //   (negative = loss, positive = profit)
            const companyNet = poolRemainder > 0
                ? poolRemainder - companyContribution
                : -companyContribution - Math.abs(poolRemainder);

            // Simplify: companyNet = poolRemainder - companyContribution
            const companyNetSimple = poolRemainder - companyContribution;

            // 10. Final result embed
            const resultEmbed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle('🎰 Roulette Result')
                .setDescription(
                    `**Final Outcome: ${resultNum} (${resultColor.toUpperCase()})**\n\n` +
                    resultLines.join('\n') +
                    `\n\n🏢 Company net: ${companyNetSimple >= 0 ? '+' : ''}$${companyNetSimple.toLocaleString()}`
                )
                .setFooter({ text: 'Better luck next time!' })
                .setTimestamp();

            await mainMsg.edit({ embeds: [resultEmbed] });

        } catch (error) {
            console.error('[Roulette] Error in game execution:', error);
            mainMsg.edit({ content: 'An error occurred processing the result.', embeds: [] }).catch(() => { });
        }
    }, 5500);
}
