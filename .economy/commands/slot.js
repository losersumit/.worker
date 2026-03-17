import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { trackTransaction } from '../utils/economyTracker.js';

// ─── Constants ──────────────────────────────────────────────────────────
const BET = 50;
const MIN_GUILD_INCOME = 100000;

// Emojis
const SPIN_EMOJI = '<a:slotmoving:1482701080281350154>';
const HELP_ICON = '<:slotmachine:1482714341634740428>';

// Symbol definitions
const SYMBOLS = {
    '777':        { emoji: '<:777:1482721437440671744>',        triple: 100000, double: 300 },
    'Seven':      { emoji: '<:Seven:1482721411779924029>',      triple: 50000,  double: 200 },
    'Bonus':      { emoji: '<:Bonus:1482721420760060095>',      triple: 0,      double: 0,     isBonus: true },
    'Wild':       { emoji: '<:Wild:1482721409733099531>',       triple: 35000,  double: 0,     isWild: true },
    'Dollar':     { emoji: '<:Dollar:1482721416028754024>',     triple: 25000,  double: 150 },
    'Crown':      { emoji: '<:Crown:1482721423024848986>',      triple: 15000,  double: 120 },
    'Bar':        { emoji: '<:Bar:1482721429760901191>',        triple: 10000,  double: 100 },
    'Watermelon': { emoji: '<:Watermelon:1482721432004988968>', triple: 7000,   double: 80 },
    'Apple':      { emoji: '<:Apple:1482721427353505802>',      triple: 5000,   double: 70 },
    'Cherry':     { emoji: '<:Cherry:1482721418125906024>',     triple: 3500,   double: 60 },
    'Lemon':      { emoji: '<:Lemon:1482721413776281764>',      triple: 2500,   double: 55 },
    'Cards':      { emoji: '<:Cards:1482721425147297834>',      triple: 2000,   double: 0 },
};

// Weighted reel strip (25 symbols)
const REEL_STRIP = [
    '777',
    'Seven',
    'Bonus',
    'Wild',
    'Dollar', 'Dollar',
    'Crown', 'Crown',
    'Bar', 'Bar',
    'Watermelon', 'Watermelon', 'Watermelon',
    'Apple', 'Apple', 'Apple',
    'Cherry', 'Cherry', 'Cherry',
    'Lemon', 'Lemon', 'Lemon',
    'Cards', 'Cards', 'Cards',
];

// Vibrant random colors palette
const RANDOM_COLORS = [
    0xE91E63, 0x9C27B0, 0x673AB7, 0x3F51B5, 0x2196F3,
    0x00BCD4, 0x009688, 0x4CAF50, 0x8BC34A, 0xFF9800,
    0xFF5722, 0xF44336, 0xE040FB, 0x7C4DFF, 0x448AFF,
    0x18FFFF, 0x69F0AE, 0xFFD740,
];

function randomColor() {
    return RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
}

// ─── Core Helpers ───────────────────────────────────────────────────────

function spinReel() {
    return REEL_STRIP[Math.floor(Math.random() * REEL_STRIP.length)];
}

function evaluateResult(r1, r2, r3) {
    const reels = [r1, r2, r3];
    const sym = (name) => SYMBOLS[name];

    // 1. Pure Triple
    if (r1 === r2 && r2 === r3) {
        if (sym(r1).isBonus) return { type: 'bonus', payout: 0, matchSymbol: r1 };
        return { type: 'triple', payout: sym(r1).triple, matchSymbol: r1 };
    }

    // 2. Wild Substitution for Triple
    const wilds = reels.filter(r => sym(r).isWild).length;
    const nonWilds = reels.filter(r => !sym(r).isWild);

    if (wilds > 0) {
        if (wilds === 3) return { type: 'triple', payout: SYMBOLS['Wild'].triple, matchSymbol: 'Wild' };
        if (wilds === 2 && nonWilds.length === 1 && !sym(nonWilds[0]).isBonus) {
            return { type: 'triple', payout: sym(nonWilds[0]).triple, matchSymbol: nonWilds[0] };
        }
        if (wilds === 1 && nonWilds.length === 2 && nonWilds[0] === nonWilds[1] && !sym(nonWilds[0]).isBonus) {
            return { type: 'triple', payout: sym(nonWilds[0]).triple, matchSymbol: nonWilds[0] };
        }
    }

    // 3. Double
    const pairs = [[0, 1], [0, 2], [1, 2]];
    for (const [a, b] of pairs) {
        const ra = reels[a], rb = reels[b];
        if (ra === rb && !sym(ra).isWild && !sym(ra).isBonus && sym(ra).double > 0) {
            return { type: 'double', payout: sym(ra).double, matchSymbol: ra };
        }
    }

    // Wild as pair member
    if (wilds === 1) {
        let bestPay = 0, bestSym = null;
        for (const nw of nonWilds) {
            if (!sym(nw).isBonus && sym(nw).double > 0 && sym(nw).double > bestPay) {
                bestPay = sym(nw).double;
                bestSym = nw;
            }
        }
        if (bestSym) return { type: 'double', payout: bestPay, matchSymbol: bestSym };
    }

    // 4. Loss
    return { type: 'loss', payout: 0, matchSymbol: null };
}

function getEmoji(symbolName) {
    return SYMBOLS[symbolName]?.emoji || '❓';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── History & Stats ────────────────────────────────────────────────────

/**
 * Format history into embed-safe chunks.
 * Discord embed field value limit = 1024 chars.
 * We split across multiple fields if needed, NO limit on total entries.
 */
function formatHistoryFields(history) {
    if (history.length === 0) return [];

    const lines = history.map(h => {
        const reelStr = `${getEmoji(h.reels[0])} ${getEmoji(h.reels[1])} ${getEmoji(h.reels[2])}`;
        const prefix = h.isFree ? '🎁' : `#${h.spinNum}`;

        switch (h.type) {
            case 'triple':  return `${prefix} ┃ ${reelStr} ┃ 🏆 **+€${h.payout.toLocaleString()}**`;
            case 'bonus':   return `${prefix} ┃ ${reelStr} ┃ ✨ **BONUS**`;
            case 'double':  return `${prefix} ┃ ${reelStr} ┃ ✅ **+€${h.payout.toLocaleString()}**`;
            case 'loss':    return `${prefix} ┃ ${reelStr} ┃ ❌ **-€${BET}**`;
            default:        return `${prefix} ┃ ${reelStr} ┃ —`;
        }
    });

    // Split into chunks that fit within 1024 chars each
    const fields = [];
    let currentChunk = '';
    let fieldIndex = 1;

    for (const line of lines) {
        const candidate = currentChunk ? currentChunk + '\n' + line : line;
        if (candidate.length > 1000) {
            // Push current chunk as a field and start new
            if (currentChunk) {
                fields.push({ name: fields.length === 0 ? `📜 Game History (${history.length} spins)` : '\u200b', value: currentChunk, inline: false });
            }
            currentChunk = line;
        } else {
            currentChunk = candidate;
        }
    }
    // Push remaining
    if (currentChunk) {
        fields.push({ name: fields.length === 0 ? `📜 Game History (${history.length} spins)` : '\u200b', value: currentChunk, inline: false });
    }

    return fields;
}

function sessionStats(history) {
    let totalWon = 0, totalLost = 0, spins = 0;
    for (const h of history) {
        if (!h.isFree) spins++;
        if (h.type === 'triple' || h.type === 'double') totalWon += h.payout;
        else if (h.type === 'loss' && !h.isFree) totalLost += BET;
    }
    return { totalWon, totalLost, spins, net: totalWon - totalLost };
}

function statsLine(history) {
    const s = sessionStats(history);
    return `Won: **€${s.totalWon.toLocaleString()}** ┃ Lost: **€${s.totalLost.toLocaleString()}** ┃ Net: **€${s.net >= 0 ? '+' : ''}${s.net.toLocaleString()}** ${s.net >= 0 ? '🟢' : '🔴'}`;
}

/**
 * Safely add history fields + stats to an embed.
 * Discord max = 25 fields. We keep some room for other fields.
 */
function addHistoryToEmbed(embed, history) {
    if (history.length === 0) return;
    const historyFields = formatHistoryFields(history);
    // Discord limits to 25 fields total, keep max 22 for history + 1 for stats
    const maxHistFields = 22;
    const fieldsToAdd = historyFields.slice(-maxHistFields);
    for (const f of fieldsToAdd) {
        embed.addFields(f);
    }
    embed.addFields({ name: '📊 Session', value: statsLine(history), inline: false });
}

// ─── Spin Animation ─────────────────────────────────────────────────────

async function runSpinAnimation(embedMsg, history, isFree = false, title = '🎰 Slot Machine') {
    const r1 = spinReel(), r2 = spinReel(), r3 = spinReel();
    const color = randomColor();

    // Phase 1: All spinning
    const e1 = new EmbedBuilder().setColor(color).setTitle(title)
        .setDescription(`\n>>> ## ${SPIN_EMOJI}  ┃  ${SPIN_EMOJI}  ┃  ${SPIN_EMOJI}\n\n*Spinning the reels...*`)
        .setFooter({ text: isFree ? 'Bonus Round — No bet deducted' : `Bet: €${BET} per spin` });
    addHistoryToEmbed(e1, history);
    await embedMsg.edit({ embeds: [e1], components: [] });
    await sleep(2000);

    // Phase 2: Reveal reel 1
    const e2 = new EmbedBuilder().setColor(color).setTitle(title)
        .setDescription(`\n>>> ## ${getEmoji(r1)}  ┃  ${SPIN_EMOJI}  ┃  ${SPIN_EMOJI}\n`)
        .setFooter({ text: isFree ? 'Bonus Round — No bet deducted' : `Bet: €${BET} per spin` });
    addHistoryToEmbed(e2, history);
    await embedMsg.edit({ embeds: [e2] });
    await sleep(2000);

    // Phase 3: Reveal reel 2
    const e3 = new EmbedBuilder().setColor(color).setTitle(title)
        .setDescription(`\n>>> ## ${getEmoji(r1)}  ┃  ${getEmoji(r2)}  ┃  ${SPIN_EMOJI}\n`)
        .setFooter({ text: isFree ? 'Bonus Round — No bet deducted' : `Bet: €${BET} per spin` });
    addHistoryToEmbed(e3, history);
    await embedMsg.edit({ embeds: [e3] });
    await sleep(2000);

    // Phase 4: Evaluate
    const result = evaluateResult(r1, r2, r3);
    return { result, reels: [r1, r2, r3], color };
}

function buildFinalEmbed(r1, r2, r3, result, history, color, isFree, title = '🎰 Slot Machine') {
    let resultLine = '';
    switch (result.type) {
        case 'bonus':  resultLine = `\n🎉 **BONUS!** Triple ${getEmoji(result.matchSymbol)} — **5 FREE SPINS UNLOCKED!**`; break;
        case 'triple': resultLine = `\n🏆 **JACKPOT!** Triple ${getEmoji(result.matchSymbol)} — Won **€${result.payout.toLocaleString()}**!`; break;
        case 'double': resultLine = `\n✅ **Double** ${getEmoji(result.matchSymbol)} — Won **€${result.payout.toLocaleString()}**!`; break;
        default:       resultLine = `\n❌ No match — Lost **€${BET}**`;
    }
    if (isFree && result.type !== 'bonus') {
        resultLine = result.type === 'loss'
            ? `\n🎁 Free Spin — No loss!`
            : `\n🎁 Free Spin — Won **€${result.payout.toLocaleString()}**!`;
    }

    const embed = new EmbedBuilder().setColor(color).setTitle(title)
        .setDescription(`\n>>> ## ${getEmoji(r1)}  ┃  ${getEmoji(r2)}  ┃  ${getEmoji(r3)}\n${resultLine}`)
        .setFooter({ text: isFree ? 'Bonus Round — No bet deducted' : `Bet: €${BET} per spin` });
    addHistoryToEmbed(embed, history);
    return embed;
}

// ─── Payout Processing ──────────────────────────────────────────────────

async function processPayout(client, message, playerId, result, isFree) {
    try {
        if (result.type === 'bonus') return;
        if (result.type === 'triple' || result.type === 'double') {
            const w = result.payout;
            if (!isFree) {
                const net = w - BET;
                await client.supabase.rpc('adjust_balance', { p_player_id: playerId, p_amount: net });
                await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: -net });
                await trackTransaction(client.supabase, playerId, 'gamble_win', w, `Slot win: ${result.type} ${result.matchSymbol}`);
            } else {
                await client.supabase.rpc('adjust_balance', { p_player_id: playerId, p_amount: w });
                await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: -w });
                await trackTransaction(client.supabase, playerId, 'gamble_win', w, `Slot free spin: ${result.type} ${result.matchSymbol}`);
            }
        } else if (!isFree) {
            await client.supabase.rpc('adjust_balance', { p_player_id: playerId, p_amount: -BET });
            await client.supabase.rpc('adjust_guild_income', { p_guild_id: message.guildId, p_amount: BET });
            await trackTransaction(client.supabase, playerId, 'gamble_loss', BET, 'Slot loss');
        }
    } catch (err) {
        console.error('[SLOT] Payout error:', err);
        message.channel.send('⚠️ An error occurred during payout. Please contact an admin.');
    }
}

// ─── Bonus Round ────────────────────────────────────────────────────────

async function runBonusRound(client, message, embedMsg, playerId, history) {
    let totalBonusWin = 0;
    for (let i = 1; i <= 5; i++) {
        await sleep(1500);
        const title = `🎁 Free Spin ${i}/5`;
        const { result, reels, color } = await runSpinAnimation(embedMsg, history, true, title);

        if (result.type === 'bonus') result.type = 'loss'; // no recursive bonus

        history.push({ reels, type: result.type, payout: result.payout, spinNum: null, isFree: true });
        if (result.payout > 0) totalBonusWin += result.payout;

        const embed = buildFinalEmbed(reels[0], reels[1], reels[2], result, history, color, true, title);
        await embedMsg.edit({ embeds: [embed], components: [] });
        await processPayout(client, message, playerId, result, true);
    }

    await sleep(1000);
    const color = randomColor();
    const summaryEmbed = new EmbedBuilder().setColor(color)
        .setTitle('🎁 Bonus Round Complete!')
        .setDescription(
            totalBonusWin > 0
                ? `You won **€${totalBonusWin.toLocaleString()}** from 5 free spins!\n\nPress **Spin** to continue or **End Slot** to cash out.`
                : `No wins from the bonus round.\n\nPress **Spin** to continue or **End Slot** to cash out.`
        )
        .setFooter({ text: `Bet: €${BET} per spin` });
    addHistoryToEmbed(summaryEmbed, history);
    return summaryEmbed;
}

// ─── Single Spin (used by both manual & batch) ──────────────────────────

async function executeSingleSpin(client, message, embedMsg, playerId, history, spinCount, isBatch = false) {
    // Re-check balance
    const { data: freshStats } = await client.supabase
        .from('player_stats').select('total_income').eq('player_id', playerId).single();

    if (freshStats.total_income < BET) {
        return { stopped: true, reason: 'broke' };
    }

    const { result, reels, color } = await runSpinAnimation(embedMsg, history, false);

    history.push({ reels, type: result.type, payout: result.payout, spinNum: spinCount, isFree: false });
    const embed = buildFinalEmbed(reels[0], reels[1], reels[2], result, history, color, false);
    await embedMsg.edit({ embeds: [embed], components: [] });
    await processPayout(client, message, playerId, result, false);

    // Handle bonus
    if (result.type === 'bonus') {
        await sleep(2000);
        const summaryEmbed = await runBonusRound(client, message, embedMsg, playerId, history);
        await embedMsg.edit({ embeds: [summaryEmbed], components: [] });
    }

    return { stopped: false };
}

// ─── Build Buttons ──────────────────────────────────────────────────────

function buildButtons(batchSize = null) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('slot_spin').setLabel('Spin').setStyle(ButtonStyle.Primary).setEmoji('🎰'),
        new ButtonBuilder().setCustomId('slot_end').setLabel('End Slot').setStyle(ButtonStyle.Danger)
    );
    if (batchSize && batchSize > 1) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`slot_batch_${batchSize}`).setLabel(`Spin another ${batchSize}`).setStyle(ButtonStyle.Success).setEmoji('🔄')
        );
    }
    return row;
}

function buildDisabledButtons(batchSize = null) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('slot_spin').setLabel('Spinning...').setStyle(ButtonStyle.Primary).setEmoji('🎰').setDisabled(true),
        new ButtonBuilder().setCustomId('slot_end').setLabel('End Slot').setStyle(ButtonStyle.Danger).setDisabled(true)
    );
    if (batchSize && batchSize > 1) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`slot_batch_${batchSize}`).setLabel(`Spin another ${batchSize}`).setStyle(ButtonStyle.Success).setEmoji('🔄').setDisabled(true)
        );
    }
    return row;
}

function buildEndButtons(batchSize = null) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('slot_spin').setLabel('Spin').setStyle(ButtonStyle.Primary).setEmoji('🎰').setDisabled(true),
        new ButtonBuilder().setCustomId('slot_end').setLabel('End Slot').setStyle(ButtonStyle.Danger).setDisabled(true)
    );
    if (batchSize && batchSize > 1) {
        row.addComponents(
            new ButtonBuilder().setCustomId(`slot_batch_${batchSize}`).setLabel(`Spin another ${batchSize}`).setStyle(ButtonStyle.Success).setEmoji('🔄').setDisabled(true)
        );
    }
    return row;
}

// ─── Batch Spin Runner ──────────────────────────────────────────────────

async function runBatchSpins(client, message, embedMsg, playerId, history, spinCountRef, batchSize) {
    for (let i = 0; i < batchSize; i++) {
        spinCountRef.value++;
        const { stopped } = await executeSingleSpin(client, message, embedMsg, playerId, history, spinCountRef.value);
        if (stopped) {
            // Out of money
            const color = randomColor();
            const brokeEmbed = new EmbedBuilder().setColor(0xFF0000)
                .setTitle('🎰 Slot Machine')
                .setDescription(`\n❌ Insufficient balance after **${i}** of **${batchSize}** spins.\nYou need **€${BET}** to continue.`)
                .setFooter({ text: `Bet: €${BET} per spin` });
            addHistoryToEmbed(brokeEmbed, history);
            await embedMsg.edit({ embeds: [brokeEmbed], components: [buildButtons(batchSize)] });
            return;
        }
        // Small pause between batch spins (after the 6s animation)
        if (i < batchSize - 1) await sleep(500);
    }
}

// ─── Main Command ───────────────────────────────────────────────────────

export default {
    name: 'slot',
    description: 'Play the Slot Machine!',
    async execute(message, args, client) {

        // ── Help Subcommand ──
        if (args[0] === 'help') {
            const embed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle(`${HELP_ICON} Slot Machine`)
                .setDescription('Spin the reels and try your luck!\nFixed bet of **€50** per spin.')
                .addFields(
                    { name: '\u200b', value: '─────────────────────────────', inline: false },
                    { name: '🎰 How to Play', value: '`?slot` — Single spin\n`?slot <number>` — Batch spin (e.g. `?slot 5`)\n`?slot stats` — See your history', inline: true },
                    { name: '💰 Bet', value: `Fixed at **€${BET}** per spin`, inline: true },
                    { name: '🏦 Requirement', value: `Guild treasury ≥ **€${MIN_GUILD_INCOME.toLocaleString()}**`, inline: true },
                    { name: '\u200b', value: '─────────────────────────────', inline: false },
                    {
                        name: '🏆 Triple Payouts (3 matching)',
                        value:
                            `${SYMBOLS['777'].emoji} **777** — €100,000\n` +
                            `${SYMBOLS['Seven'].emoji} **Seven** — €50,000\n` +
                            `${SYMBOLS['Wild'].emoji} **Wild** — €35,000\n` +
                            `${SYMBOLS['Dollar'].emoji} **Dollar** — €25,000\n` +
                            `${SYMBOLS['Crown'].emoji} **Crown** — €15,000\n` +
                            `${SYMBOLS['Bar'].emoji} **Bar** — €10,000\n` +
                            `${SYMBOLS['Watermelon'].emoji} **Watermelon** — €7,000\n` +
                            `${SYMBOLS['Apple'].emoji} **Apple** — €5,000\n` +
                            `${SYMBOLS['Cherry'].emoji} **Cherry** — €3,500\n` +
                            `${SYMBOLS['Lemon'].emoji} **Lemon** — €2,500\n` +
                            `${SYMBOLS['Cards'].emoji} **Cards** — €2,000`,
                        inline: false
                    },
                    { name: '\u200b', value: '─────────────────────────────', inline: false },
                    {
                        name: '✨ Double Payouts (2 matching)',
                        value:
                            `${SYMBOLS['777'].emoji} **777** — €300\n` +
                            `${SYMBOLS['Seven'].emoji} **Seven** — €200\n` +
                            `${SYMBOLS['Dollar'].emoji} **Dollar** — €150\n` +
                            `${SYMBOLS['Crown'].emoji} **Crown** — €120\n` +
                            `${SYMBOLS['Bar'].emoji} **Bar** — €100\n` +
                            `${SYMBOLS['Watermelon'].emoji} **Watermelon** — €80\n` +
                            `${SYMBOLS['Apple'].emoji} **Apple** — €70\n` +
                            `${SYMBOLS['Cherry'].emoji} **Cherry** — €60\n` +
                            `${SYMBOLS['Lemon'].emoji} **Lemon** — €55`,
                        inline: false
                    },
                    { name: '\u200b', value: '─────────────────────────────', inline: false },
                    {
                        name: '🃏 Special Symbols',
                        value:
                            `${SYMBOLS['Wild'].emoji} **Wild** — Substitutes for any symbol (except Bonus)\n` +
                            `${SYMBOLS['Bonus'].emoji} **Bonus** — Triple Bonus triggers **5 FREE SPINS**`,
                        inline: false
                    }
                )
                .setFooter({ text: 'Spin responsibly • Good luck! 🍀' });

            return message.reply({ embeds: [embed] });
        }

        // ── Stats Subcommand ──
        if (args[0] === 'stats') {
            await message.channel.sendTyping();
            try {
                const { data: player } = await client.supabase.from('players').select('id').eq('discord_id', message.author.id).single();
                if (!player) return message.reply('You are not registered in the economy system.');

                const { data: history } = await client.supabase
                    .from('player_economy_history')
                    .select('transaction_type, amount, details')
                    .eq('player_id', player.id)
                    .ilike('details', '%Slot%');

                let totalWon = 0;
                let totalLost = 0;
                let wins = 0;
                let losses = 0;
                let jackpots = 0;

                for (const h of history || []) {
                    const amt = parseFloat(h.amount);
                    if (h.transaction_type === 'gamble_win') {
                        totalWon += amt;
                        wins++;
                        if (h.details.includes('triple')) jackpots++;
                    } else if (h.transaction_type === 'gamble_loss') {
                        totalLost += amt;
                        losses++;
                    }
                }

                const totalPlayed = wins + losses;
                const winPercent = totalPlayed > 0 ? ((wins / totalPlayed) * 100).toFixed(1) : 0;
                
                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle(`🎰 Slot Stats: ${message.author.username}`)
                    .addFields(
                        { name: 'Spins Played', value: `**${totalPlayed}**`, inline: true },
                        { name: 'Win Rate', value: `**${winPercent}%**`, inline: true },
                        { name: '\x20', value: '\x20', inline: true }, // spacer
                        { name: 'Total Profit', value: `**€${totalWon.toLocaleString()}**`, inline: true },
                        { name: 'Total Lost', value: `**€${totalLost.toLocaleString()}**`, inline: true },
                        { name: 'Net Profit', value: `**€${(totalWon - totalLost).toLocaleString()}**`, inline: true },
                        { name: 'Jackpots (Triples)', value: `**${jackpots}**`, inline: true },
                        { name: 'Regular Wins', value: `**${wins - jackpots}**`, inline: true },
                        { name: '\x20', value: '\x20', inline: true } // spacer
                    )
                    .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));

                return message.reply({ embeds: [embed] });
            } catch (err) {
                console.error('Error fetching slot stats:', err);
                return message.reply('Failed to load stats.');
            }
        }

        // ── Parse batch size ──
        let batchSize = null;
        if (args[0] && !isNaN(parseInt(args[0]))) {
            batchSize = Math.max(1, Math.min(5, parseInt(args[0]))); // cap at 5
        }

        // ── Main Slot Game ──
        await message.channel.sendTyping();

        try {
            // Fetch player
            const { data: player } = await client.supabase
                .from('players').select('id').eq('discord_id', message.author.id).single();
            if (!player) return message.reply('You are not registered in the economy system.');

            const { data: stats } = await client.supabase
                .from('player_stats').select('total_income').eq('player_id', player.id).single();
            if (stats.total_income < BET) {
                return message.reply(`You need at least **€${BET}** to play. Your balance: **€${Math.floor(stats.total_income).toLocaleString()}**`);
            }

            // Check guild income
            const { data: guild } = await client.supabase
                .from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
            const guildIncome = parseFloat(guild?.guild_income || 0);
            if (guildIncome < MIN_GUILD_INCOME) {
                return message.reply(`The guild treasury needs at least **€${MIN_GUILD_INCOME.toLocaleString()}** to run the slot machine. Current: **€${Math.floor(guildIncome).toLocaleString()}**`);
            }

            // Session state
            const history = [];
            const spinCountRef = { value: 0 }; // mutable ref for batch

            // Initial embed
            const color = randomColor();
            const initialEmbed = new EmbedBuilder()
                .setColor(color)
                .setTitle('🎰 Slot Machine')
                .setDescription(
                    `\nWelcome, **${message.author.username}**!\n\n` +
                    (batchSize
                        ? `Starting **${batchSize}** automatic spins...\nEach spin costs **€${BET}**.`
                        : `Press **Spin** to start spinning the reels.\nEach spin costs **€${BET}**.`)
                )
                .setFooter({ text: `Bet: €${BET} per spin • Session active` });

            const buttons = buildButtons(batchSize);
            const embedMsg = await message.reply({ embeds: [initialEmbed], components: batchSize ? [] : [buttons] });

            // ── If batch mode, run initial batch automatically ──
            if (batchSize) {
                await runBatchSpins(client, message, embedMsg, player.id, history, spinCountRef, batchSize);
                // Show buttons after batch completes
                const latestEmbed = EmbedBuilder.from(embedMsg.embeds?.[0] || {});
                // Don't re-edit the embed content, just add buttons
                await embedMsg.edit({ components: [buildButtons(batchSize)] });
            }

            // ── Button Collector ──
            const collector = embedMsg.createMessageComponentCollector({ time: 300000 });
            let spinning = false;

            collector.on('collect', async (i) => {
                if (i.user.id !== message.author.id) {
                    return i.reply({ content: 'This is not your slot machine!', flags: 64 });
                }
                
                // ── End Slot ──
                if (i.customId === 'slot_end') {
                    await i.deferUpdate();
                    const s = sessionStats(history);
                    const endEmbed = new EmbedBuilder().setColor(randomColor())
                        .setTitle('🎰 Slot Machine — Session Over')
                        .setDescription(
                            `Thanks for playing, **${message.author.username}**!\n\n` +
                            `**Session Summary**\n` +
                            `Spins: **${s.spins}** ┃ Won: **€${s.totalWon.toLocaleString()}** ┃ Lost: **€${s.totalLost.toLocaleString()}**\n` +
                            `Net: **€${s.net >= 0 ? '+' : ''}${s.net.toLocaleString()}** ${s.net >= 0 ? '🟢' : '🔴'}`
                        )
                        .setFooter({ text: 'Use ?slot to play again.' });
                    addHistoryToEmbed(endEmbed, history);
                    await embedMsg.edit({ embeds: [endEmbed], components: [buildEndButtons(batchSize)] });
                    collector.stop('user_end');
                    return;
                }

                // ── Batch Spin Button ──
                if (i.customId.startsWith('slot_batch_')) {
                    if (spinning) return;
                    await i.deferUpdate();
                    spinning = true;
                    const num = parseInt(i.customId.split('_')[2]);
                    await embedMsg.edit({ components: [buildDisabledButtons(num)] });
                    await runBatchSpins(client, message, embedMsg, player.id, history, spinCountRef, num);
                    await embedMsg.edit({ components: [buildButtons(num)] });
                    spinning = false;
                    return;
                }

                // ── Single Spin ──
                if (i.customId === 'slot_spin') {
                    if (spinning) return;
                    await i.deferUpdate();
                    spinning = true;

                    // Re-check balance
                    const { data: freshStats } = await client.supabase
                        .from('player_stats').select('total_income').eq('player_id', player.id).single();
                    if (freshStats.total_income < BET) {
                        const brokeEmbed = new EmbedBuilder().setColor(0xFF0000)
                            .setTitle('🎰 Slot Machine')
                            .setDescription(`\n❌ Insufficient balance! You need **€${BET}** to spin.\n\nYour balance: **€${Math.floor(freshStats.total_income).toLocaleString()}**`)
                            .setFooter({ text: `Bet: €${BET} per spin` });
                        addHistoryToEmbed(brokeEmbed, history);
                        await embedMsg.edit({ embeds: [brokeEmbed], components: [buildEndButtons(batchSize)] });
                        collector.stop('user_end');
                        return;
                    }

                    await embedMsg.edit({ components: [buildDisabledButtons(batchSize)] });
                    spinCountRef.value++;
                    await executeSingleSpin(client, message, embedMsg, player.id, history, spinCountRef.value);
                    await embedMsg.edit({ components: [buildButtons(batchSize)] });
                    spinning = false;
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason !== 'user_end') {
                    const s = sessionStats(history);
                    const timeoutEmbed = new EmbedBuilder().setColor(randomColor())
                        .setTitle('🎰 Slot Machine — Session Timed Out')
                        .setDescription(
                            `Session timed out for **${message.author.username}**.\n\n` +
                            `**Session Summary**\n` +
                            `Spins: **${s.spins}** ┃ Won: **€${s.totalWon.toLocaleString()}** ┃ Lost: **€${s.totalLost.toLocaleString()}**\n` +
                            `Net: **€${s.net >= 0 ? '+' : ''}${s.net.toLocaleString()}** ${s.net >= 0 ? '🟢' : '🔴'}`
                        )
                        .setFooter({ text: 'Use ?slot to play again.' });
                    addHistoryToEmbed(timeoutEmbed, history);
                    await embedMsg.edit({ embeds: [timeoutEmbed], components: [buildEndButtons(batchSize)] }).catch(() => {});
                }
            });

        } catch (err) {
            console.error('[SLOT] Error:', err);
            message.reply('An error occurred while setting up the slot machine.');
        }
    }
};

export {
    BET, MIN_GUILD_INCOME, SPIN_EMOJI, SYMBOLS, REEL_STRIP, RANDOM_COLORS,
    randomColor, spinReel, evaluateResult, getEmoji, sleep,
    formatHistoryFields, sessionStats, statsLine, addHistoryToEmbed,
    runSpinAnimation, buildFinalEmbed, processPayout, runBonusRound,
    executeSingleSpin, buildButtons, buildDisabledButtons, buildEndButtons, runBatchSpins
};
