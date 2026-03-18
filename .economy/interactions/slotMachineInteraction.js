import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
    BET, MIN_GUILD_INCOME, SPIN_EMOJI,
    randomColor, spinReel, evaluateResult, getEmoji, sleep, processPayout
} from '../commands/slot.js';

const EMOJI_SEVEN = '<:Seven:1482721411779924029>';
const EMOJI_SLOT = '\u{1F3B0}';
const EMOJI_FREE = '\u{1F381}';
const EMOJI_HISTORY = '\u{1F4DC}';
const EMOJI_BONUS = '\u2728';
const EMOJI_PARTY = '\u{1F389}';
const EMOJI_TROPHY = '\u{1F3C6}';
const EMOJI_CHECK = '\u2705';
const EMOJI_CROSS = '\u274C';
const SESSION_TIMEOUT_MS = 3 * 60 * 1000;
const machineResetTimers = new Map();

function parseStateFromEmbed(embed) {
    const desc = embed.description || '';
    const occupiedMatch = desc.match(/Machine currently occupied by:\*?\s*<@(\d+)>/);
    const occupiedBy = occupiedMatch ? occupiedMatch[1] : null;
    const lastSpinTime = embed.timestamp ? new Date(embed.timestamp).getTime() : Date.now();

    return { occupiedBy, lastSpinTime };
}

function getHistoryLinesFromEmbed(embed) {
    const historyFields = [];
    let collectingHistory = false;

    for (const field of embed.fields) {
        if (typeof field.name !== 'string') {
            continue;
        }

        if (field.name.includes('Game History')) {
            collectingHistory = true;
            historyFields.push(field);
            continue;
        }

        if (collectingHistory && field.name === '\u200b') {
            historyFields.push(field);
            continue;
        }

        if (collectingHistory) {
            break;
        }
    }

    const historyValue = historyFields
        .map((field) => field.value)
        .filter(Boolean)
        .join('\n');

    if (!historyValue || historyValue === '*No spins yet.*') {
        return [];
    }

    return historyValue
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function createDefaultSlotEmbed(machineId) {
    return new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`${EMOJI_SLOT} Slot Machine #${machineId}`)
        .setDescription(
`*Machine currently occupied by:* **None**

${EMOJI_SEVEN} | ${EMOJI_SEVEN} | ${EMOJI_SEVEN}

✨ **This Session**
Spins: 0  
Won: €0  
Lost: €0  
Net: €0

Bet: €${BET} | Status: Free | ` 
        )
        .setTimestamp(new Date());
}

function createDefaultSlotRow(machineId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`slot_machine_spin_${machineId}`).setLabel('Spin').setStyle(ButtonStyle.Primary).setEmoji(EMOJI_SLOT),
        new ButtonBuilder().setCustomId(`slot_machine_leave_${machineId}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
}


function calculateSessionStats(historyLines) {
    let totalWon = 0;
    let totalLost = 0;
    let paidSpins = 0;

    for (const line of historyLines) {
        if (!line.startsWith(EMOJI_FREE)) {
            paidSpins += 1;
        }

        const winMatch = line.match(/\+€([\d,]+)/);
        if (winMatch) {
            totalWon += Number(winMatch[1].replace(/,/g, ''));
        }

        if (line.includes(`-${'€'}${BET}`)) {
            totalLost += BET;
        }
    }

    return {
        paidSpins,
        totalWon,
        totalLost,
        net: totalWon - totalLost
    };
}

function buildHistoryFields(historyLines) {
    if (historyLines.length === 0) {
        return [{
            name: `${EMOJI_HISTORY} Game History`,
            value: '*No spins yet.*',
            inline: false
        }];
    }

    const chunks = [];
    let currentChunk = '';

    for (const line of historyLines) {
        const candidate = currentChunk ? `${currentChunk}\n${line}` : line;
        if (candidate.length > 1024) {
            if (currentChunk) {
                chunks.push(currentChunk);
            }
            currentChunk = line;
        } else {
            currentChunk = candidate;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    const maxHistoryFields = 24;
    const visibleChunks = chunks.slice(-maxHistoryFields);

    return visibleChunks.map((chunk, index) => ({
        name: index === 0
            ? `${EMOJI_HISTORY} Game History (${historyLines.length} spins)`
            : '\u200b',
        value: chunk,
        inline: false
    }));
}

function addHistoryAndSessionFields(embed, historyLines) {
    const historyFields = buildHistoryFields(historyLines);
    const stats = calculateSessionStats(historyLines);
    const remainingFieldSlots = 24;
    const safeHistoryFields = historyFields.slice(-remainingFieldSlots);

    embed.addFields(...safeHistoryFields);
    embed.addFields({
        name: `${EMOJI_BONUS} This Session`,
        value: `Spins: **${stats.paidSpins}**\nWon: **€${stats.totalWon.toLocaleString()}**\nLost: **€${stats.totalLost.toLocaleString()}**\nNet: **€${stats.net >= 0 ? '+' : ''}${stats.net.toLocaleString()}** ${stats.net >= 0 ? '🟢' : '🔴'}`,
        inline: false
    });
}

function createActiveSlotRow(machineId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`slot_machine_spin_${machineId}`)
            .setLabel(disabled ? 'Spinning...' : 'Spin')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(EMOJI_SLOT)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`slot_machine_leave_${machineId}`)
            .setLabel('Leave')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled)
    );
}

async function resetMachineMessage(message, machineId) {
    machineResetTimers.delete(message.id);
    await message.edit({
        embeds: [createDefaultSlotEmbed(machineId)],
        components: [createDefaultSlotRow(machineId)]
    });
}

function scheduleMachineReset(message, machineId, occupierId) {
    const existingTimer = machineResetTimers.get(message.id);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
        try {
            const freshMessage = await message.channel.messages.fetch(message.id);
            const freshEmbed = freshMessage.embeds[0];
            if (!freshEmbed) {
                machineResetTimers.delete(message.id);
                return;
            }

            const state = parseStateFromEmbed(freshEmbed);
            const stillActive = state.occupiedBy === occupierId;
            const expired = Date.now() - state.lastSpinTime >= SESSION_TIMEOUT_MS;

            if (stillActive && expired) {
                await resetMachineMessage(freshMessage, machineId);
            }
        } catch (error) {
            console.error(`[SLOTS] Failed to auto-reset machine #${machineId}:`, error);
        } finally {
            machineResetTimers.delete(message.id);
        }
    }, SESSION_TIMEOUT_MS + 1000);

    machineResetTimers.set(message.id, timer);
}

async function runPermanentSpinAnimation(interaction, message, machineId, currentOccupier, historyLines, isFree = false, spinNum = 1, forceTitle = null) {
    const r1 = spinReel();
    const r2 = spinReel();
    const r3 = spinReel();
    const color = randomColor();
    const title = forceTitle || `${EMOJI_SLOT} Slot Machine #${machineId}`;

    const buildPhaseEmbed = (spinText) => {
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(`*Machine currently occupied by:* <@${currentOccupier}>\n\n>>> ## ${spinText}\n*Spinning the reels...*`)
            .setFooter({ text: isFree ? 'Bonus Round - No bet deducted | Status: In use' : `Bet: €${BET} | Status: In use` })
            .setTimestamp(new Date());

        addHistoryAndSessionFields(embed, historyLines);

        return embed;
    };

    const rowDisabled = createActiveSlotRow(machineId, true);

    await interaction.editReply({ embeds: [buildPhaseEmbed(`${SPIN_EMOJI}  |  ${SPIN_EMOJI}  |  ${SPIN_EMOJI}`)], components: [rowDisabled] });
    await sleep(1000);

    await interaction.editReply({ embeds: [buildPhaseEmbed(`${getEmoji(r1)}  |  ${SPIN_EMOJI}  |  ${SPIN_EMOJI}`)], components: [rowDisabled] });
    await sleep(1000);

    await interaction.editReply({ embeds: [buildPhaseEmbed(`${getEmoji(r1)}  |  ${getEmoji(r2)}  |  ${SPIN_EMOJI}`)], components: [rowDisabled] });
    await sleep(1000);

    const result = evaluateResult(r1, r2, r3);
    const reelStr = `${getEmoji(r1)} | ${getEmoji(r2)} | ${getEmoji(r3)}`;
    const prefix = isFree ? EMOJI_FREE : `#${spinNum}`;
    let historyLine = '';
    let resultLine = '';

    switch (result.type) {
        case 'bonus':
            historyLine = `${prefix} | ${reelStr} | ${EMOJI_BONUS} BONUS`;
            resultLine = `\n${EMOJI_PARTY} BONUS! Triple ${getEmoji(result.matchSymbol)} - 5 FREE SPINS UNLOCKED!`;
            break;
        case 'triple':
            historyLine = `${prefix} | ${reelStr} | ${EMOJI_TROPHY} +€${result.payout.toLocaleString()}`;
            resultLine = `\n${EMOJI_TROPHY} JACKPOT! Triple ${getEmoji(result.matchSymbol)} - Won €${result.payout.toLocaleString()}!`;
            break;
        case 'double':
            historyLine = `${prefix} | ${reelStr} | ${EMOJI_CHECK} +€${result.payout.toLocaleString()}`;
            resultLine = `\n${EMOJI_CHECK} Double ${getEmoji(result.matchSymbol)} - Won €${result.payout.toLocaleString()}!`;
            break;
        default:
            historyLine = `${prefix} | ${reelStr} | ${EMOJI_CROSS} -€${BET}`;
            resultLine = `\n${EMOJI_CROSS} No match - Lost €${BET}`;
            break;
    }

    if (isFree && result.type !== 'bonus') {
        historyLine = result.type === 'loss' ? `${prefix} | ${reelStr} | ${EMOJI_FREE} FREE` : historyLine;
        resultLine = result.type === 'loss'
            ? `\n${EMOJI_FREE} Free Spin - No loss!`
            : `\n${EMOJI_FREE} Free Spin - Won €${result.payout.toLocaleString()}!`;
    }

    const finalEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`*Machine currently occupied by:* <@${currentOccupier}>\n\n>>> ## ${getEmoji(r1)}  |  ${getEmoji(r2)}  |  ${getEmoji(r3)}\n${resultLine}`)
        .setFooter({ text: isFree ? 'Bonus Round - No bet deducted | Status: In use' : `Bet: €${BET} | Status: In use` })
        .setTimestamp(new Date());

    const updatedHistoryLines = [...historyLines, historyLine];
    addHistoryAndSessionFields(finalEmbed, updatedHistoryLines);

    return { result, finalEmbed, updatedHistoryLines, rowActive: createActiveSlotRow(machineId, false) };
}

async function runPermanentBonusRound(interaction, message, machineId, playerId, currentOccupier, historyLines) {
    let totalBonusWin = 0;
    const client = interaction.client;

    for (let i = 1; i <= 5; i++) {
        await sleep(1500);
        const title = `${EMOJI_FREE} Slot Machine #${machineId} (Free Spin ${i}/5)`;

        const { result, finalEmbed, updatedHistoryLines } = await runPermanentSpinAnimation(
            interaction,
            message,
            machineId,
            currentOccupier,
            historyLines,
            true,
            i,
            title
        );

        if (result.type === 'bonus') {
            result.type = 'loss';
        }

        historyLines = updatedHistoryLines;
        if (result.payout > 0) {
            totalBonusWin += result.payout;
        }

        await interaction.editReply({
            embeds: [finalEmbed],
            components: [createActiveSlotRow(machineId, true)]
        });

        await processPayout(client, message, playerId, result, true);
    }

    await sleep(1000);

    const summaryEmbed = new EmbedBuilder()
        .setColor(randomColor())
        .setTitle(`${EMOJI_SLOT} Slot Machine #${machineId}`)
        .setDescription(
            `*Machine currently occupied by:* <@${currentOccupier}>\n\n` +
            (totalBonusWin > 0
                ? `**${EMOJI_FREE} Bonus Round Complete!**\nYou won **€${totalBonusWin.toLocaleString()}** from 5 free spins!\n\nPress **Spin** to play again or **Leave** to free the machine.`
                : `**${EMOJI_FREE} Bonus Round Complete!**\nNo wins from the bonus round.\n\nPress **Spin** to play again or **Leave** to free the machine.`)
        )
        .setFooter({ text: `Bet: €${BET} | Status: In use` })
        .setTimestamp(new Date());

    addHistoryAndSessionFields(summaryEmbed, historyLines);

    await interaction.editReply({
        embeds: [summaryEmbed],
        components: [createActiveSlotRow(machineId, false)]
    });

    scheduleMachineReset(message, machineId, currentOccupier);
}

async function handleLeaveInteraction(interaction, machineId) {
    const message = interaction.message;
    const embed = message.embeds[0];

    if (!embed) {
        return interaction.reply({ content: 'Message is corrupted. Please contact an administrator.', ephemeral: true });
    }

    const state = parseStateFromEmbed(embed);
    const timedOut = Date.now() - state.lastSpinTime >= SESSION_TIMEOUT_MS;

    if (!state.occupiedBy || timedOut) {
        await interaction.deferUpdate();
        await resetMachineMessage(message, machineId);
        return;
    }

    if (state.occupiedBy !== interaction.user.id) {
        return interaction.reply({ content: 'Only the current player can leave this machine.', ephemeral: true });
    }

    await interaction.deferUpdate();
    await resetMachineMessage(message, machineId);
}

export async function handleSlotMachineInteraction(interaction, client) {
    const customId = interaction.customId;
    const machineId = customId.split('_').pop();

    if (customId.startsWith('slot_machine_leave_')) {
        return handleLeaveInteraction(interaction, machineId);
    }

    const message = interaction.message;
    const embed = message.embeds[0];

    if (!embed) {
        return interaction.reply({ content: 'Message is corrupted. Please contact an administrator.', ephemeral: true });
    }

    const state = parseStateFromEmbed(embed);
    const timeSinceLastSpin = Date.now() - state.lastSpinTime;
    const isOccupiedByOther = state.occupiedBy && state.occupiedBy !== interaction.user.id;
    const isTimeout = timeSinceLastSpin >= SESSION_TIMEOUT_MS;

    if (isTimeout && state.occupiedBy) {
        await resetMachineMessage(message, machineId);
    }

    if (isOccupiedByOther && !isTimeout) {
        const remainingSec = Math.ceil((SESSION_TIMEOUT_MS - timeSinceLastSpin) / 1000);
        return interaction.reply({
            content: `This machine is currently occupied by <@${state.occupiedBy}>. They have ${remainingSec} seconds left to spin before the machine frees up.`,
            ephemeral: true
        });
    }

    const channelMessages = await interaction.channel.messages.fetch({ limit: 15 });
    for (const [msgId, msg] of channelMessages) {
        if (msgId === message.id) {
            continue;
        }

        const otherEmbed = msg.embeds[0];
        if (otherEmbed && otherEmbed.title && otherEmbed.title.includes('Slot Machine #')) {
            const otherState = parseStateFromEmbed(otherEmbed);
            const otherTimeSinceLastSpin = Date.now() - otherState.lastSpinTime;
            const isOtherTimeout = otherTimeSinceLastSpin >= SESSION_TIMEOUT_MS;

            if (otherState.occupiedBy === interaction.user.id && !isOtherTimeout) {
                const otherMachineId = otherEmbed.title.split('#')[1];
                return interaction.reply({
                    content: `You are already occupying Slot Machine #${otherMachineId}. You can only play on one machine at a time!`,
                    ephemeral: true
                });
            }
        }
    }

    const isNewOccupier = (isOccupiedByOther && isTimeout) || !state.occupiedBy || (state.occupiedBy === interaction.user.id && isTimeout);

    await interaction.deferUpdate();

    const { data: player } = await client.supabase.from('players').select('id').eq('discord_id', interaction.user.id).single();
    if (!player) {
        return interaction.followUp({ content: 'You are not registered in the economy system.', ephemeral: true });
    }

    const { data: stats } = await client.supabase.from('player_stats').select('total_income').eq('player_id', player.id).single();
    if (stats.total_income < BET) {
        return interaction.followUp({
            content: `Insufficient balance. You need **€${BET}**. Your balance: **€${Math.floor(stats.total_income).toLocaleString()}**`,
            ephemeral: true
        });
    }

    const { data: guild } = await client.supabase.from('approved_guilds').select('guild_income').eq('guild_id', message.guildId).single();
    if (parseFloat(guild?.guild_income || 0) < MIN_GUILD_INCOME) {
        return interaction.followUp({
            content: `The guild treasury needs at least **€${MIN_GUILD_INCOME.toLocaleString()}** to run the slots.`,
            ephemeral: true
        });
    }

    let historyLines = [];
    let spinNum = 1;

    if (!isNewOccupier) {
        historyLines = getHistoryLinesFromEmbed(embed);
        if (historyLines.length > 0) {
            spinNum = historyLines.filter((line) => !line.startsWith(EMOJI_FREE)).length + 1;
        }
    }

    const { result, finalEmbed, updatedHistoryLines, rowActive } = await runPermanentSpinAnimation(
        interaction,
        message,
        machineId,
        interaction.user.id,
        historyLines,
        false,
        spinNum,
        null
    );

    await interaction.editReply({ embeds: [finalEmbed], components: [rowActive] });
    scheduleMachineReset(message, machineId, interaction.user.id);

    await processPayout(client, message, player.id, result, false);

    if (result.type === 'bonus') {
        await sleep(1000);
        await runPermanentBonusRound(interaction, message, machineId, player.id, interaction.user.id, updatedHistoryLines);
    }
}

export { createDefaultSlotEmbed, createDefaultSlotRow, resetMachineMessage };
