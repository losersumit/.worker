import { Events, EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { moderateMessage, moderateImage } from '../systems/moderation.js';
import { addWarning } from '../systems/storage.js';
import { handleLevelScanning } from '../features/levelScanning.js';
import { handleCounting } from '../features/counting.js';
import { handleChat } from '../features/chat.js';
import { bufferMessage, checkForUnprompted } from '../features/ambient.js';
import { logMessageModeration, takeModAction, getActionDescription } from '../utils/moderationUtils.js';
import { recentActivity } from '../utils/activityState.js';

export default {
    name: Events.MessageCreate,
    async execute(message, client) {
        // Ignore messages from bots (including itself)
        if (message.author.bot) return;

        // Buffer EVERY message for ambient awareness (before any returns)
        bufferMessage(message, client);

        // Check for unprompted reaction on EVERY message (fire-and-forget)
        checkForUnprompted(message, client).catch(err =>
            console.error('[Ambient] Unprompted check error:', err.message)
        );

        // Hook for legacy economy commands (prefix '?')
        if (message.content.startsWith('?')) {
            if (process.env.CHANNEL_ID && message.channelId !== process.env.CHANNEL_ID) {
                return;
            }

            const args = message.content.slice(1).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            const command = client.legacyCommands?.get(commandName);

            if (command) {
                try {
                    await command.execute(message, args, client);
                } catch (error) {
                    console.error('Error executing legacy command:', error);
                    message.reply('There was an error executing that command!').catch(() => { });
                }
                // Stop further processing (like moderation or chat) for economy commands
                return;
            }
        }

        // Level Scanning (Job Logs)
        await handleLevelScanning(message);
        const jobLogChannelId = process.env.JOB_LOG_CHANNEL_ID;
        if (jobLogChannelId && message.channel.id === jobLogChannelId) {
            // Return if we want to skip other moderation/logic for job logs
            return;
        }

        // Counting Channel
        await handleCounting(message);
        const countingChannelId = process.env.COUNTING_CHANNEL_ID;
        if (message.channel.id === countingChannelId) {
            return;
        }

        // Moderation skip rules (chat/FAQ can still run even if moderation is skipped)
        const isIgnoredChannel = config.moderation.ignoredChannels.includes(message.channel.id);
        const hasIgnoredRole = Boolean(
            message.member &&
            message.member.roles.cache.some(role => config.moderation.ignoredRoles.includes(role.id))
        );
        const shouldModerate = !isIgnoredChannel && !hasIgnoredRole;

        try {
            if (shouldModerate) {
                let moderationResult = await moderateMessage(message.content);

                // Check for image attachments if text wasn't flagged
                // console.log(`[Debug] Message has ${message.attachments.size} attachments. Text flagged: ${moderationResult.isFlagged}`);

                if (!moderationResult.isFlagged && message.attachments.size > 0) {
                    for (const [id, attachment] of message.attachments) {
                        // console.log(`[Debug] Checking attachment: ${attachment.contentType}, URL: ${attachment.url}`);
                        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                            // console.log('[Debug] Attachment identifies as image. Calling moderateImage...');
                            const imageResult = await moderateImage(attachment.url);
                            if (imageResult.isFlagged) {
                                moderationResult = imageResult;
                                break; // Stop checking images if one is flagged
                            }
                        } else {
                            // console.log('[Debug] Attachment is NOT an image or has no content type.');
                        }
                    }
                }

                if (moderationResult.isFlagged) {
                    // Delete the message if it's flagged
                    await message.delete();

                    // Update recent activity counters
                    recentActivity.lastModeration = Date.now();
                    recentActivity.moderationCount++;

                    // Record the warning
                    const userId = message.author.id;
                    const { userData, recommendedAction } = await addWarning(
                        userId,
                        moderationResult.reason,
                        moderationResult.severity,
                        config
                    );

                    // Log the action to console
                    const channelMessage = `A message from ${message.author.tag} was removed for violating community guidelines.`;
                    if (config.logging.consoleLog) {
                        console.log(channelMessage);
                    }

                    // Log to mod-logs channel
                    await logMessageModeration(
                        client,
                        message.guild,
                        message.member,
                        message.channel,
                        moderationResult,
                        userData,
                        recommendedAction,
                        message.content
                    );

                    // Send an enhanced DM to the user
                    try {
                        // Choose emoji based on severity
                        let severityEmoji = '⚠️';
                        let severityColor = config.appearance.colors.warning;

                        switch (moderationResult.severity.toLowerCase()) {
                            case 'high':
                                severityEmoji = '🔴';
                                severityColor = config.appearance.colors.highSeverity;
                                break;
                            case 'medium':
                                severityEmoji = '🟠';
                                severityColor = config.appearance.colors.mediumSeverity;
                                break;
                            case 'low':
                                severityEmoji = '🟡';
                                severityColor = config.appearance.colors.lowSeverity;
                                break;
                            default:
                                severityEmoji = '⚠️';
                                severityColor = config.appearance.colors.warning;
                        }

                        // Create a warning message based on warning count
                        let warningMessage = 'Please be mindful of our community guidelines.';
                        if (userData.count >= 3) {
                            warningMessage = '**⚠️ Warning:** Continued violations will result in moderation actions.';
                        }
                        if (userData.count >= 5) {
                            warningMessage = '**⛔ Caution:** Your account is at risk of temporary restrictions.';
                        }
                        if (userData.count >= 7) {
                            warningMessage = '**🚫 Final Warning:** Further violations will result in removal from the server.';
                        }

                        const dmEmbed = new EmbedBuilder()
                            .setColor(severityColor)
                            .setTitle(`${severityEmoji} Your Message Was Moderated`)
                            .setDescription(`Your message in ${message.channel} was removed for violating our community guidelines.`)
                            .addFields(
                                { name: '📝 Reason', value: `\`${moderationResult.reason}\`` },
                                { name: `${severityEmoji} Severity`, value: `\`${moderationResult.severity.toUpperCase()}\``, inline: true },
                                { name: '🔄 Warning Count', value: `\`${userData.count}\``, inline: true }
                            )
                            .addFields(
                                { name: '⚠️ Notice', value: warningMessage }
                            )
                            .setFooter({ text: 'AI-powered moderation' })
                            .setTimestamp();

                        await message.author.send({ embeds: [dmEmbed] });

                        // If this resulted in a moderation action, let them know
                        if (recommendedAction) {
                            const actionEmbed = new EmbedBuilder()
                                .setColor(config.appearance.colors.error)
                                .setTitle('🛑 Moderation Action Applied')
                                .setDescription(`Due to multiple violations, the following action has been taken:`)
                                .addFields(
                                    { name: '🔨 Action', value: getActionDescription(recommendedAction) }
                                )
                                .setFooter({ text: 'This action was applied automatically based on your warning history' })
                                .setTimestamp();

                            await message.author.send({ embeds: [actionEmbed] });
                        }
                    } catch (error) {
                        console.log(`Could not send DM to ${message.author.tag}: ${error}`);

                        // If we can't DM them, send a minimal message in the channel if configured to do so
                        if (config.appearance.sendChannelNotificationsWhenDMFails) {
                            try {
                                const warningMsg = await message.channel.send(`${message.author}, your message was removed for violating community guidelines. Please check server rules.`);
                                // Delete the notification after the configured timeout to keep the channel clean
                                setTimeout(() => warningMsg.delete().catch(e => { }), config.appearance.channelNotificationTimeout);
                            } catch (err) {
                                console.error(`Could not send channel notification: ${err}`);
                            }
                        }
                    }

                    // Take automated actions based on warning count
                    if (recommendedAction && message.member) {
                        await takeModAction(client, message.member, recommendedAction, message.guild, moderationResult.reason);
                    }

                    // If message was moderated/deleted, don't also run chat/FAQ on it.
                    return;
                }
            }

            // ===== Mention chat + FAQ =====
            await handleChat(message, client);

        } catch (error) {
            console.error(`Error processing message: ${error}`);
        }
    },
};
