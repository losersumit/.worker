import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import path from 'path';
import {
    BET, MIN_GUILD_INCOME, SPIN_EMOJI,
    randomColor, spinReel, evaluateResult, getEmoji, sleep, processPayout
} from '../commands/slot.js';

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
    const historyField = embed.fields.find((field) => typeof field.name === 'string' && field.name.includes('Game History'));
    if (!historyField || !historyField.value || historyField.value === '*No spins yet.*') {
        return [];
    }

    return historyField.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function getSlotAttachment() {
    const slotImage = path.join(process.cwd(), 'slot_machine.png');
    return new AttachmentBuilder(slotImage, { name: 'slot_machine.png' });
}

function createDefaultSlotEmbed(machineId) {
    return new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`${EMOJI_SLOT} Slot Machine #${machineId}`)
        .setDescription('*Machine currently occupied by:* **None**')
        .setThumbnail('attachment://slot_machine.png')
        .setFooter({ text: `Bet: €${BET} | Free to play` })
        .setTimestamp(new Date());
}

function createDefaultSlotRow(machineId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`slot_machine_spin_${machineId}`).setLabel('Spin').setStyle(ButtonStyle.Primary).setEmoji(EMOJI_SLOT),
        new ButtonBuilder().setCustomId(`slot_machine_leave_${machineId}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(true)
    );
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
    const attachment = getSlotAttachment();
    await message.edit({
        embeds: [createDefaultSlotEmbed(machineId)],
        components: [createDefaultSlotRow(machineId)],
        files: [attachment]
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
            .setThumbnail('attachment://slot_machine.png')
            .setFooter({ text: isFree ? 'Bonus Round - No bet deducted | Status: In use' : `Bet: €${BET} | Status: In use` })
            .setTimestamp(new Date());

        embed.addFields({
            name: `${EMOJI_HISTORY} Game History`,
            value: historyLines.length > 0 ? historyLines.slice(-10).join('\n') : '*No spins yet.*',
            inline: false
        });

        return embed;
    };

    const rowDisabled = createActiveSlotRow(machineId, true);
    const attachment = getSlotAttachment();

    await interaction.editReply({ embeds: [buildPhaseEmbed(`${SPIN_EMOJI}  |  ${SPIN_EMOJI}  |  ${SPIN_EMOJI}`)], components: [rowDisabled], files: [attachment] });
    await sleep(2000);

    await interaction.editReply({ embeds: [buildPhaseEmbed(`${getEmoji(r1)}  |  ${SPIN_EMOJI}  |  ${SPIN_EMOJI}`)], components: [rowDisabled], files: [attachment] });
    await sleep(2000);

    await interaction.editReply({ embeds: [buildPhaseEmbed(`${getEmoji(r1)}  |  ${getEmoji(r2)}  |  ${SPIN_EMOJI}`)], components: [rowDisabled], files: [attachment] });
    await sleep(2000);

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
        .setThumbnail('attachment://slot_machine.png')
        .setFooter({ text: isFree ? 'Bonus Round - No bet deducted | Status: In use' : `Bet: €${BET} | Status: In use` })
        .setTimestamp(new Date());

    const updatedHistoryLines = [...historyLines, historyLine];
    finalEmbed.addFields({ name: `${EMOJI_HISTORY} Game History`, value: updatedHistoryLines.slice(-10).join('\n'), inline: false });

    return { result, finalEmbed, updatedHistoryLines, rowActive: createActiveSlotRow(machineId, false), attachment };
}

async function runPermanentBonusRound(interaction, message, machineId, playerId, currentOccupier, historyLines) {
    let totalBonusWin = 0;
    const client = interaction.client;

    for (let i = 1; i <= 5; i++) {
        await sleep(1500);
        const title = `${EMOJI_FREE} Slot Machine #${machineId} (Free Spin ${i}/5)`;

        const { result, finalEmbed, updatedHistoryLines, attachment } = await runPermanentSpinAnimation(
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
            components: [createActiveSlotRow(machineId, true)],
            files: [attachment]
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
        .setThumbnail('attachment://slot_machine.png')
        .setFooter({ text: `Bet: €${BET} | Status: In use` })
        .setTimestamp(new Date());

    summaryEmbed.addFields({ name: `${EMOJI_HISTORY} Game History`, value: historyLines.slice(-10).join('\n'), inline: false });

    await interaction.editReply({
        embeds: [summaryEmbed],
        components: [createActiveSlotRow(machineId, false)],
        files: [getSlotAttachment()]
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

    const { result, finalEmbed, updatedHistoryLines, rowActive, attachment } = await runPermanentSpinAnimation(
        interaction,
        message,
        machineId,
        interaction.user.id,
        historyLines,
        false,
        spinNum,
        null
    );

    await interaction.editReply({ embeds: [finalEmbed], components: [rowActive], files: [attachment] });
    scheduleMachineReset(message, machineId, interaction.user.id);

    await processPayout(client, message, player.id, result, false);

    if (result.type === 'bonus') {
        await sleep(2000);
        await runPermanentBonusRound(interaction, message, machineId, player.id, interaction.user.id, updatedHistoryLines);
    }
}

export { createDefaultSlotEmbed, createDefaultSlotRow, resetMachineMessage };
