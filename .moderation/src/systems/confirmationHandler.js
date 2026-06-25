/**
 * Confirmation Handler
 * Handles Confirm/Cancel button clicks on agent preview embeds.
 * Button custom IDs: `agent_confirm:${userId}:${channelId}` / `agent_cancel:${userId}:${channelId}`
 */

import { getSession, updateSession, clearSession, STATES } from './taskSession.js';
import { EmbedBuilder } from 'discord.js';

// Role IDs authorized to confirm agent actions (Commander / Partner)
const AUTHORIZED_ROLE_IDS = [
    process.env.COMMANDER_ROLE_ID,
    process.env.PARTNER_ROLE_ID,
].filter(Boolean);

/**
 * Handle an agent confirmation or cancellation button interaction.
 * @param {ButtonInteraction} interaction
 * @param {Client} client
 */
export async function handleAgentConfirmation(interaction, client) {
    const customId = interaction.customId;

    // Parse: agent_confirm:userId:channelId or agent_cancel:userId:channelId
    const parts = customId.split(':');
    if (parts.length < 3) {
        await interaction.reply({ content: '❌ Invalid button data.', ephemeral: true });
        return;
    }

    const action = parts[0];         // 'agent_confirm' or 'agent_cancel'
    const sessionUserId = parts[1];  // The user who owns the session
    const sessionChannelId = parts[2];

    // Verify the clicking user is the session owner
    if (interaction.user.id !== sessionUserId) {
        await interaction.reply({ content: '❌ This isn\'t your preview to confirm.', ephemeral: true });
        return;
    }

    // Check authorization (Commander/Partner role)
    const hasAuth = interaction.member?.roles?.cache?.some(role => AUTHORIZED_ROLE_IDS.includes(role.id));
    if (!hasAuth) {
        await interaction.reply({ content: '❌ You don\'t have permission to execute this action.', ephemeral: true });
        return;
    }

    // Get the session
    const session = getSession(sessionUserId, sessionChannelId);
    if (!session || session.state !== STATES.AWAITING_CONFIRMATION) {
        await interaction.reply({ content: '⏰ This session has expired or is no longer pending.', ephemeral: true });
        return;
    }

    // ===== CONFIRM =====
    if (action === 'agent_confirm') {
        await interaction.deferUpdate();

        try {
            const pending = session.pendingAction;
            if (!pending) {
                await interaction.followUp({ content: '❌ No pending action found in session.', ephemeral: true });
                clearSession(sessionUserId, sessionChannelId);
                return;
            }

            let targetChannelName = 'unknown';

            // Execute the stored action: send embed via webhook or channel
            if (pending.webhookUrl) {
                // Send via webhook
                const { default: axios } = await import('axios');
                const webhookPayload = { embeds: [pending.embedData] };
                if (pending.content) webhookPayload.content = pending.content;
                await axios.post(pending.webhookUrl, webhookPayload, {
                    headers: { 'Content-Type': 'application/json' }
                });
                targetChannelName = pending.channelName || 'webhook channel';
            } else if (pending.targetChannelId) {
                // Send via channel
                const targetChannel = await client.channels.fetch(pending.targetChannelId).catch(() => null);
                if (!targetChannel) {
                    await interaction.followUp({ content: '❌ Target channel not found.', ephemeral: true });
                    clearSession(sessionUserId, sessionChannelId);
                    return;
                }
                targetChannelName = targetChannel.name || 'channel';

                const sendPayload = {};
                if (pending.embedData) {
                    const embed = new EmbedBuilder(pending.embedData);
                    sendPayload.embeds = [embed];
                }
                if (pending.content) sendPayload.content = pending.content;

                await targetChannel.send(sendPayload);
            } else {
                await interaction.followUp({ content: '❌ No target configured for this action.', ephemeral: true });
                clearSession(sessionUserId, sessionChannelId);
                return;
            }

            // Update the preview message to show success
            const successEmbed = new EmbedBuilder()
                .setColor(0x00cc66)
                .setTitle('✅ Sent Successfully')
                .setDescription(`Message sent to **#${targetChannelName}**.`)
                .setTimestamp();

            await interaction.editReply({
                embeds: [successEmbed],
                components: [] // Remove buttons
            });

            // Update session and clear
            updateSession(sessionUserId, sessionChannelId, { state: STATES.CONFIRMED });
            clearSession(sessionUserId, sessionChannelId);

            console.log(`[AgentConfirm] Action confirmed by ${interaction.user.tag} → #${targetChannelName}`);

        } catch (err) {
            console.error('[AgentConfirm] Execution error:', err);
            await interaction.followUp({ content: '❌ Failed to execute the action.', ephemeral: true }).catch(() => {});
            clearSession(sessionUserId, sessionChannelId);
        }
        return;
    }

    // ===== CANCEL =====
    if (action === 'agent_cancel') {
        await interaction.deferUpdate();

        const cancelEmbed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Cancelled')
            .setDescription('Nothing was sent.')
            .setTimestamp();

        await interaction.editReply({
            embeds: [cancelEmbed],
            components: [] // Remove buttons
        });

        updateSession(sessionUserId, sessionChannelId, { state: STATES.CANCELLED });
        clearSession(sessionUserId, sessionChannelId);

        console.log(`[AgentConfirm] Action cancelled by ${interaction.user.tag}`);
        return;
    }

    // Unknown action prefix
    await interaction.reply({ content: '❌ Unknown action.', ephemeral: true });
}
