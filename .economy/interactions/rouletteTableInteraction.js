import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

// --- Constants ---
const ROULETTE_IMG = 'https://cdn.discordapp.com/attachments/1464745553559687393/1471034895295053896/vector-realistic-casino-roulette-table-wheel-chips-top-view-isolated-green-background.png?ex=698d7781&is=698c2601&hm=ce262a71c66a2a11c1f85a380943780f979c93e0d1312eb317a9fd2dbdb10f57';
const SPINNING_GIF = 'https://cdn.discordapp.com/attachments/1455232294901121195/1471076088586174637/Untitled_design_2.gif?ex=698d9dde&is=698c4c5e&hm=7b0ee2462e6d17427a6b4314d8265ee2f5f591ccbb284e7734b7d9dfd741b47a';
const MAX_PLAYERS = 5;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY_LINES = 8;
const EMOJI_TABLE = '\u{1F3B0}';

const RED_NUMS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

const BET_OPTIONS = [
    { id: 'red', label: 'Red', style: ButtonStyle.Danger, row: 0 },
    { id: 'black', label: 'Black', style: ButtonStyle.Secondary, row: 0 },
    { id: 'even', label: 'Even', style: ButtonStyle.Primary, row: 0 },
    { id: 'odd', label: 'Odd', style: ButtonStyle.Primary, row: 0 },
    { id: '1-18', label: '1-18', style: ButtonStyle.Success, row: 1 },
    { id: '19-36', label: '19-36', style: ButtonStyle.Success, row: 1 },
    { id: '1st12', label: '1st12', style: ButtonStyle.Secondary, row: 2 },
    { id: '2nd12', label: '2nd12', style: ButtonStyle.Secondary, row: 2 },
    { id: '3rd12', label: '3rd12', style: ButtonStyle.Secondary, row: 2 },
];

// Payout multipliers (total return including original bet)
const PAYOUT_MULTIPLIERS = {
    'red': 2, 'black': 2, 'even': 2, 'odd': 2,
    '1-18': 2, '19-36': 2,
    '1st12': 3, '2nd12': 3, '3rd12': 3,
};

// --- In-memory state ---
// Map<messageId, TableState>
const tableStates = new Map();
// Set<`${messageId}:${userId}`> — users currently typing their bet amount
const waitingForAmount = new Set();

// ========================================================================
// ROULETTE LOGIC
// ========================================================================

function getRouletteColor(num) {
    if (num === 0) return 'green';
    return RED_NUMS.includes(num) ? 'red' : 'black';
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
        case '1st12': return resultNum >= 1 && resultNum <= 12;
        case '2nd12': return resultNum >= 13 && resultNum <= 24;
        case '3rd12': return resultNum >= 25 && resultNum <= 36;
        default: return false;
    }
}

function getColorEmoji(color) {
    if (color === 'red') return '🔴';
    if (color === 'black') return '⚫';
    return '🟢';
}

function getBetLabel(betId) {
    const opt = BET_OPTIONS.find((b) => b.id === betId);
    return opt ? opt.label : betId;
}

// ========================================================================
// SUPABASE HELPERS
// ========================================================================

async function getPlayerRecord(supabase, discordId) {
    const { data, error } = await supabase.from('players').select('id').eq('discord_id', discordId).single();
    if (error) return null;
    return data;
}

async function getPlayerBalance(supabase, playerId) {
    const { data, error } = await supabase.from('player_stats').select('wallet').eq('player_id', playerId).single();
    if (error) return 0;
    return data?.wallet || 0;
}

async function getGuildIncome(supabase, guildId) {
    const { data, error } = await supabase.from('approved_guilds').select('guild_income').eq('guild_id', guildId).single();
    if (error) return null;
    return data;
}

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
// TABLE STATE MANAGEMENT
// ========================================================================

function getTableState(messageId) {
    return tableStates.get(messageId) || null;
}

function createTableState(messageId) {
    const state = {
        players: new Map(),       // Map<userId, PlayerState>
        history: [],              // Array of history line strings
        lastActivity: Date.now(),
        inactivityTimer: null,
        spinning: false,          // true when the wheel is spinning for everyone
    };
    tableStates.set(messageId, state);
    return state;
}

function clearTableState(messageId) {
    const state = tableStates.get(messageId);
    if (state) {
        if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
        tableStates.delete(messageId);
    }
}

function touchActivity(state, message, tableId, client) {
    state.lastActivity = Date.now();
    scheduleInactivityReset(state, message, tableId, client);
}

function scheduleInactivityReset(state, message, tableId, client) {
    if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
    state.inactivityTimer = setTimeout(async () => {
        try {
            const freshMsg = await message.channel.messages.fetch(message.id);
            // Only reset if this state still exists and matches
            const currentState = getTableState(message.id);
            if (currentState && currentState.players.size > 0) {
                // Refund all players who have active bets
                for (const [userId, p] of currentState.players) {
                    if (p.amount > 0 && p.player_id) {
                        try {
                            await addPlayerWallet(client.supabase, p.player_id, p.amount);
                        } catch (e) {
                            console.error(`[ROULETTE] Failed to refund ${userId}:`, e);
                        }
                    }
                }
                clearTableState(message.id);
                await freshMsg.edit({
                    embeds: [defaultRouletteEmbed(tableId)],
                    components: defaultRouletteRows(tableId),
                });
            }
        } catch (e) {
            console.error(`[ROULETTE] Inactivity reset error for table #${tableId}:`, e);
        }
    }, INACTIVITY_TIMEOUT_MS);
}

// ========================================================================
// UI BUILDERS
// ========================================================================

function tableTitle(tableId) {
    return `${EMOJI_TABLE} Roulette Table #${tableId}`;
}

function defaultRouletteEmbed(tableId) {
    return new EmbedBuilder()
        .setColor(0x00AA55)
        .setTitle(tableTitle(tableId))
        .setDescription('**Players at table:** None\n\n*No players seated. Press **Sit** to join.*')
        .setImage(ROULETTE_IMG)
        .setFooter({ text: 'Permanent roulette table • Player vs House' })
        .setTimestamp(new Date());
}

function defaultRouletteRows(tableId) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`roulette_table_sit_${tableId}`).setLabel('Sit').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`roulette_table_leave_${tableId}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(true),
    )];
}

function buildActiveRows(tableId, spinning = false) {
    const rows = [0, 1, 2].map((row) => new ActionRowBuilder().addComponents(
        ...BET_OPTIONS.filter((b) => b.row === row).map((b) => new ButtonBuilder()
            .setCustomId(`roulette_table_bet_${tableId}_${b.id}`)
            .setLabel(b.label)
            .setStyle(b.style)
            .setDisabled(spinning)),
    ));

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`roulette_table_sit_${tableId}`).setLabel('Sit').setStyle(ButtonStyle.Success).setDisabled(spinning),
        new ButtonBuilder().setCustomId(`roulette_table_add_${tableId}`).setLabel('Add Bet').setStyle(ButtonStyle.Primary).setDisabled(spinning),
        new ButtonBuilder().setCustomId(`roulette_table_ready_${tableId}`).setLabel('Ready').setStyle(ButtonStyle.Success).setDisabled(spinning),
        new ButtonBuilder().setCustomId(`roulette_table_leave_${tableId}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(spinning),
    ));

    return rows;
}

function buildTableEmbed(state, tableId) {
    const playerNames = [];
    const playerLines = [];

    for (const [userId, p] of state.players) {
        playerNames.push(p.username);

        let line = `**${p.username}**`;
        if (p.amount > 0) {
            line += ` — Bet: €${p.amount.toLocaleString()}`;
            if (p.choice) {
                line += ` → ${getBetLabel(p.choice)}`;
            }
            line += p.ready ? ' ✅' : ' ⏳';
        } else {
            line += ' — *waiting to place bet*';
        }
        playerLines.push(line);
    }

    const playersAtTable = playerNames.length > 0 ? playerNames.join(', ') : 'None';
    const historyText = state.history.length > 0
        ? state.history.slice(-MAX_HISTORY_LINES).join('\n')
        : '*No games played yet.*';

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle(tableTitle(tableId))
        .setDescription(
            `**Players at table:** ${playersAtTable}\n\n` +
            playerLines.join('\n') +
            `\n\n📜 **Game History**\n${historyText}`,
        )
        .setImage(ROULETTE_IMG)
        .setFooter({ text: `Up to ${MAX_PLAYERS} players • Player vs House` })
        .setTimestamp(new Date());

    return embed;
}

// ========================================================================
// CHECK: One user, one table
// ========================================================================

function isUserAtAnotherTable(userId, currentMessageId) {
    for (const [msgId, state] of tableStates) {
        if (msgId === currentMessageId) continue;
        if (state.players.has(userId)) return true;
    }
    return false;
}

// ========================================================================
// AUTO-DELETE NON-BET MESSAGES
// ========================================================================

function setupChannelCleaner(channel, client) {
    // We track which channels already have a collector to avoid duplicates
    if (!client._rouletteCleanerChannels) client._rouletteCleanerChannels = new Set();
    if (client._rouletteCleanerChannels.has(channel.id)) return;
    client._rouletteCleanerChannels.add(channel.id);

    const collector = channel.createMessageCollector({
        filter: (m) => m.author.id !== client.user.id,
    });

    collector.on('collect', async (msg) => {
        // Check if this message is from someone waiting to type their bet amount
        let isWaiting = false;
        for (const key of waitingForAmount) {
            if (key.endsWith(`:${msg.author.id}`)) {
                isWaiting = true;
                break;
            }
        }
        // If not waiting for amount → delete after a short delay
        if (!isWaiting) {
            try { await msg.delete(); } catch { /* ignore */ }
        }
        // If waiting, the amount collector handles deletion
    });
}

// ========================================================================
// MAIN INTERACTION HANDLER
// ========================================================================

export async function handleRouletteTableInteraction(interaction, client) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    // Format: roulette_table_{action}_{tableId}[_{betId}]
    const action = parts[2];
    const tableId = parts[3];
    const message = interaction.message;

    // Set up auto-delete for non-bet messages in this channel
    setupChannelCleaner(interaction.channel, client);

    // --- SIT ---
    if (action === 'sit') {
        return handleSit(interaction, client, tableId);
    }

    // --- LEAVE ---
    if (action === 'leave') {
        return handleLeave(interaction, client, tableId);
    }

    // --- ADD BET ---
    if (action === 'add') {
        return handleAddBet(interaction, client, tableId);
    }

    // --- READY ---
    if (action === 'ready') {
        return handleReady(interaction, client, tableId);
    }

    // --- BET CHOICE (Red, Black, etc.) ---
    if (action === 'bet') {
        const betId = parts.slice(4).join('_'); // e.g. '1st12', '1-18'
        return handleBetChoice(interaction, client, tableId, betId);
    }
}

// ========================================================================
// ACTION HANDLERS
// ========================================================================

async function handleSit(interaction, client, tableId) {
    const message = interaction.message;
    const userId = interaction.user.id;

    // Check if user is at another table
    if (isUserAtAnotherTable(userId, message.id)) {
        return interaction.reply({ content: 'You are already seated at another roulette table!', flags: MessageFlags.Ephemeral });
    }

    let state = getTableState(message.id);

    // Check if already seated at THIS table
    if (state && state.players.has(userId)) {
        return interaction.reply({ content: 'You are already seated at this table!', flags: MessageFlags.Ephemeral });
    }

    // Check max players
    if (state && state.players.size >= MAX_PLAYERS) {
        return interaction.reply({ content: `This table is full! (Max ${MAX_PLAYERS} players)`, flags: MessageFlags.Ephemeral });
    }

    // Create state if needed
    if (!state) {
        state = createTableState(message.id);
    }

    // Add player (no bet yet)
    state.players.set(userId, {
        player_id: null,
        username: interaction.user.username,
        amount: 0,
        choice: null,
        ready: false,
    });

    touchActivity(state, message, tableId, client);
    await interaction.deferUpdate();
    await message.edit({
        embeds: [buildTableEmbed(state, tableId)],
        components: buildActiveRows(tableId),
    });
}

async function handleLeave(interaction, client, tableId) {
    const message = interaction.message;
    const userId = interaction.user.id;
    const state = getTableState(message.id);

    if (!state || !state.players.has(userId)) {
        return interaction.reply({ content: 'You are not seated at this table.', flags: MessageFlags.Ephemeral });
    }

    // If spinning, can't leave
    if (state.spinning) {
        return interaction.reply({ content: 'You cannot leave while the wheel is spinning!', flags: MessageFlags.Ephemeral });
    }

    const player = state.players.get(userId);

    // Refund any active bet
    if (player.amount > 0 && player.player_id) {
        try {
            await addPlayerWallet(client.supabase, player.player_id, player.amount);
        } catch (e) {
            console.error(`[ROULETTE] Refund error on leave for ${userId}:`, e);
        }
    }

    state.players.delete(userId);

    // Remove this player's history lines
    state.history = state.history.filter((line) => !line.startsWith(`${player.username} |`));

    await interaction.deferUpdate();

    // If no players left, reset table
    if (state.players.size === 0) {
        clearTableState(message.id);
        await message.edit({
            embeds: [defaultRouletteEmbed(tableId)],
            components: defaultRouletteRows(tableId),
        });
        return;
    }

    // Otherwise update the embed
    touchActivity(state, message, tableId, client);
    await message.edit({
        embeds: [buildTableEmbed(state, tableId)],
        components: buildActiveRows(tableId),
    });
}

async function handleAddBet(interaction, client, tableId) {
    const message = interaction.message;
    const userId = interaction.user.id;
    const state = getTableState(message.id);

    if (!state || !state.players.has(userId)) {
        return interaction.reply({ content: 'You must **Sit** at the table before adding a bet.', flags: MessageFlags.Ephemeral });
    }

    const playerState = state.players.get(userId);

    if (state.spinning) {
        return interaction.reply({ content: 'The wheel is spinning! Wait for the result.', flags: MessageFlags.Ephemeral });
    }

    const key = `${message.id}:${userId}`;
    if (waitingForAmount.has(key)) {
        return interaction.reply({ content: 'You are already entering a bet amount! Type it in chat.', flags: MessageFlags.Ephemeral });
    }

    // Get player DB record
    const playerRecord = await getPlayerRecord(client.supabase, userId);
    if (!playerRecord) {
        return interaction.reply({ content: 'You are not registered in the economy system.', flags: MessageFlags.Ephemeral });
    }

    const balance = await getPlayerBalance(client.supabase, playerRecord.id);
    if (balance <= 0) {
        return interaction.reply({ content: 'You have no money to bet!', flags: MessageFlags.Ephemeral });
    }

    waitingForAmount.add(key);
    await interaction.reply({ content: `Type your **bet amount** below (you have €${Math.floor(balance).toLocaleString()}):`, flags: MessageFlags.Ephemeral });

    const filter = (m) => m.author.id === userId && m.channel.id === message.channel.id;
    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

    collector.on('collect', async (amtMsg) => {
        waitingForAmount.delete(key);
        const rawAmt = amtMsg.content.trim().toLowerCase();
        try { await amtMsg.delete(); } catch { /* ignore */ }

        // Re-check balance (may have changed)
        const freshBalance = await getPlayerBalance(client.supabase, playerRecord.id);
        let amount = rawAmt === 'all' ? freshBalance : Math.floor(parseFloat(rawAmt));

        if (isNaN(amount) || amount <= 0) {
            return interaction.followUp({ content: 'Invalid amount.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        if (freshBalance < amount) {
            return interaction.followUp({ content: `Insufficient balance! You have €${Math.floor(freshBalance).toLocaleString()}.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // Check house can afford potential payout (3x for 12-bets is the max)
        const guild = await getGuildIncome(client.supabase, message.guildId);
        if (!guild) {
            return interaction.followUp({ content: 'This server is not initialized for the economy system.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        const maxPayout = amount * 3; // Worst case: 12-bet wins 3x
        const houseBalance = parseFloat(guild.guild_income || 0);
        if (houseBalance < maxPayout) {
            return interaction.followUp({ content: `The house cannot afford the max potential payout! House balance: €${Math.floor(houseBalance).toLocaleString()}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // Refund previous bet if any
        if (playerState.amount > 0 && playerState.player_id) {
            try {
                await addPlayerWallet(client.supabase, playerState.player_id, playerState.amount);
            } catch (e) {
                console.error(`[ROULETTE] Failed to refund previous bet for ${userId}:`, e);
            }
        }

        // Deduct new bet from player wallet
        try {
            await deductPlayerWallet(client.supabase, playerRecord.id, amount);
        } catch (e) {
            console.error(`[ROULETTE] Failed to deduct bet for ${userId}:`, e);
            return interaction.followUp({ content: 'Failed to deduct your bet. Try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // Update state
        playerState.player_id = playerRecord.id;
        playerState.amount = amount;
        playerState.choice = null;
        playerState.ready = false;

        touchActivity(state, message, tableId, client);
        await message.edit({
            embeds: [buildTableEmbed(state, tableId)],
            components: buildActiveRows(tableId),
        });
    });

    collector.on('end', (collected, reason) => {
        waitingForAmount.delete(key);
        if (reason === 'time' && collected.size === 0) {
            interaction.followUp({ content: 'You took too long! Bet entry cancelled.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    });
}

async function handleBetChoice(interaction, client, tableId, betId) {
    const message = interaction.message;
    const userId = interaction.user.id;
    const state = getTableState(message.id);

    if (!state || !state.players.has(userId)) {
        return interaction.reply({ content: 'You must **Sit** at the table first.', flags: MessageFlags.Ephemeral });
    }

    if (!BET_OPTIONS.some((b) => b.id === betId)) {
        return interaction.reply({ content: 'Invalid bet option.', flags: MessageFlags.Ephemeral });
    }

    const playerState = state.players.get(userId);

    if (playerState.amount <= 0) {
        return interaction.reply({ content: 'You need to **Add Bet** first before choosing an option.', flags: MessageFlags.Ephemeral });
    }

    if (state.spinning) {
        return interaction.reply({ content: 'The wheel is spinning! Wait for the result.', flags: MessageFlags.Ephemeral });
    }

    if (playerState.ready) {
        return interaction.reply({ content: 'Your game is already in progress! Wait for the result.', flags: MessageFlags.Ephemeral });
    }

    // Update choice (can change freely until Ready)
    playerState.choice = betId;

    touchActivity(state, message, tableId, client);
    await interaction.deferUpdate();
    await message.edit({
        embeds: [buildTableEmbed(state, tableId)],
        components: buildActiveRows(tableId),
    });
}

async function handleReady(interaction, client, tableId) {
    const message = interaction.message;
    const userId = interaction.user.id;
    const state = getTableState(message.id);

    if (!state || !state.players.has(userId)) {
        return interaction.reply({ content: 'You must **Sit** at the table first.', flags: MessageFlags.Ephemeral });
    }

    if (state.spinning) {
        return interaction.reply({ content: 'The wheel is already spinning! Wait for the result.', flags: MessageFlags.Ephemeral });
    }

    const playerState = state.players.get(userId);

    if (playerState.amount <= 0) {
        return interaction.reply({ content: 'You need to **Add Bet** first.', flags: MessageFlags.Ephemeral });
    }

    if (!playerState.choice) {
        return interaction.reply({ content: 'Select a bet option (Red, Black, etc.) before clicking Ready.', flags: MessageFlags.Ephemeral });
    }

    if (playerState.ready) {
        return interaction.reply({ content: 'You are already marked as ready!', flags: MessageFlags.Ephemeral });
    }

    // Mark as ready
    playerState.ready = true;

    touchActivity(state, message, tableId, client);
    await interaction.deferUpdate();

    // Check if ALL betting players are now ready
    const bettingPlayers = getBettingPlayers(state);
    const allReady = bettingPlayers.length > 0 && bettingPlayers.every((p) => p.ready);

    if (!allReady) {
        // Just update the embed to show this player is ready, wait for others
        await message.edit({
            embeds: [buildTableEmbed(state, tableId)],
            components: buildActiveRows(tableId),
        });
        return;
    }

    // All betting players are ready — spin the wheel!
    state.spinning = true;
    await executeTableSpin(client, message, state, tableId);
}

// ========================================================================
// SPIN EXECUTION (Common spin for ALL betting players)
// ========================================================================

/** Get all players who have an active bet (amount > 0) */
function getBettingPlayers(state) {
    const result = [];
    for (const [userId, p] of state.players) {
        if (p.amount > 0) result.push(p);
    }
    return result;
}

async function executeTableSpin(client, message, state, tableId) {
    const guildId = message.guildId;
    const bettingPlayers = getBettingPlayers(state);

    // Show spinning embed
    const playerNames = bettingPlayers.map((p) => p.username).join(', ');
    const spinEmbed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle(`${tableTitle(tableId)} — 🎡 Spinning...`)
        .setDescription(
            buildPlayersDescription(state) +
            `\n\n*Spinning the wheel for **${playerNames}**...*` +
            `\n\n📜 **Game History**\n${state.history.length > 0 ? state.history.slice(-MAX_HISTORY_LINES).join('\n') : '*No games played yet.*'}`,
        )
        .setImage(SPINNING_GIF)
        .setFooter({ text: 'The wheel is spinning...' })
        .setTimestamp(new Date());

    await message.edit({ embeds: [spinEmbed], components: buildActiveRows(tableId, true) });

    // Wait for visual effect
    await sleep(4000);

    try {
        // ONE result for everyone
        const resultNum = Math.floor(Math.random() * 37); // 0-36
        const resultColor = getRouletteColor(resultNum);
        const resultEmoji = getColorEmoji(resultColor);

        const updatePromises = [];
        const roundHistoryLines = [];

        // Process each betting player individually against the house
        for (const p of bettingPlayers) {
            const won = doesBetWin(p.choice, resultNum);
            const multiplier = PAYOUT_MULTIPLIERS[p.choice] || 2;

            if (won) {
                const totalPayout = Math.floor(p.amount * multiplier);
                const netProfit = totalPayout - p.amount;
                const tax = Math.floor(netProfit * 0.20);
                const payoutAfterTax = totalPayout - tax;

                // Pay player
                updatePromises.push(addPlayerWallet(client.supabase, p.player_id, payoutAfterTax));
                // House pays out (deduct totalPayout, then add back bet + tax)
                updatePromises.push(deductCompany(client.supabase, guildId, totalPayout));
                updatePromises.push(addCompany(client.supabase, guildId, p.amount)); // house keeps original bet
                if (tax > 0) {
                    updatePromises.push(addCompany(client.supabase, guildId, tax));
                    updatePromises.push(trackTransaction(client, p.player_id, 'tax', tax, 'Roulette Winnings Tax'));
                }
                updatePromises.push(trackTransaction(client, p.player_id, 'gamble_win', netProfit - tax, `Won Roulette — ${resultNum} ${resultColor}`));

                roundHistoryLines.push(`${p.username} | ${resultEmoji} ${resultNum} ${resultColor.toUpperCase()} | ✅ +€${(netProfit - tax).toLocaleString()} [-€${tax.toLocaleString()} tax]`);
            } else {
                // Player loses — house keeps the bet
                updatePromises.push(addCompany(client.supabase, guildId, p.amount));
                updatePromises.push(trackTransaction(client, p.player_id, 'gamble_loss', p.amount, `Lost Roulette — ${resultNum} ${resultColor}`));

                roundHistoryLines.push(`${p.username} | ${resultEmoji} ${resultNum} ${resultColor.toUpperCase()} | ❌ -€${p.amount.toLocaleString()}`);
            }
        }

        await Promise.all(updatePromises);

        // Add history lines
        state.history.push(...roundHistoryLines);
        if (state.history.length > MAX_HISTORY_LINES) {
            state.history = state.history.slice(-MAX_HISTORY_LINES);
        }

        // Reset ALL betting players for next round (still seated)
        for (const p of bettingPlayers) {
            p.amount = 0;
            p.choice = null;
            p.ready = false;
        }

        state.spinning = false;

        // Update embed with result
        touchActivity(state, message, tableId, client);
        await message.edit({
            embeds: [buildTableEmbed(state, tableId)],
            components: buildActiveRows(tableId),
        });

    } catch (error) {
        console.error(`[ROULETTE] Table spin error:`, error);
        state.spinning = false;

        // Try to refund all betting players on error
        for (const p of bettingPlayers) {
            try {
                if (p.amount > 0 && p.player_id) {
                    await addPlayerWallet(client.supabase, p.player_id, p.amount);
                }
            } catch (refundErr) {
                console.error(`[ROULETTE] Refund error for ${p.username}:`, refundErr);
            }
            p.amount = 0;
            p.choice = null;
            p.ready = false;
        }

        await message.edit({
            embeds: [buildTableEmbed(state, tableId)],
            components: buildActiveRows(tableId),
        });
    }
}

// ========================================================================
// HELPERS
// ========================================================================

function buildPlayersDescription(state) {
    const playerLines = [];
    for (const [userId, p] of state.players) {
        let line = `**${p.username}**`;
        if (p.amount > 0) {
            line += ` — Bet: €${p.amount.toLocaleString()}`;
            if (p.choice) line += ` → ${getBetLabel(p.choice)}`;
            line += p.ready ? ' ✅' : ' ⏳';
        } else {
            line += ' — *waiting to place bet*';
        }
        playerLines.push(line);
    }
    const names = Array.from(state.players.values()).map((p) => p.username);
    return `**Players at table:** ${names.join(', ')}\n\n${playerLines.join('\n')}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export { defaultRouletteEmbed, defaultRouletteRows };
