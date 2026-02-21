import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getUserWarnings } from '../systems/storage.js';
import config from '../config.js';

/**
 * Take a moderation action against a member
 * @param {Client} client - The Discord client
 * @param {GuildMember} member - The guild member to take action against
 * @param {string} action - The action to take
 * @param {Guild} guild - The guild where the action should be taken
 * @param {string} reason - The reason for the action
 */
export async function takeModAction(client, member, action, guild, reason) {
    try {
        const fullReason = `AI Moderation: ${reason}`;

        switch (action) {
            case 'timeout_1h':
                await member.timeout(60 * 60 * 1000, fullReason); // 1 hour in milliseconds
                await logModAction(client, guild, member, 'timeout (1 hour)', fullReason);
                break;

            case 'timeout_24h':
                await member.timeout(24 * 60 * 60 * 1000, fullReason); // 24 hours in milliseconds
                await logModAction(client, guild, member, 'timeout (24 hours)', fullReason);
                break;

            case 'kick':
                await member.kick(fullReason);
                await logModAction(client, guild, member, 'kick', fullReason);
                break;

            case 'ban':
                await member.ban({ reason: fullReason, deleteMessageSeconds: 60 * 60 * 24 }); // Delete 24h of messages
                await logModAction(client, guild, member, 'ban', fullReason);
                break;
        }
    } catch (error) {
        console.error(`Error taking mod action: ${error}`);
    }
}

/**
 * Log a moderation action to the mod-logs channel (if it exists)
 * @param {Client} client - The Discord client
 * @param {Guild} guild - The guild where the action was taken
 * @param {GuildMember} member - The member the action was taken against
 * @param {string} action - The action taken
 * @param {string} reason - The reason for the action
 */
export async function logModAction(client, guild, member, action, reason) {
    // Try to find a channel for mod logs
    let logChannel;

    for (const channelName of config.logging.modLogChannels) {
        const channel = guild.channels.cache.find(
            ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
        );
        if (channel) {
            logChannel = channel;
            break;
        }
    }

    // If no log channel is found, create a private one if configured to do so
    if (!logChannel && config.logging.createLogChannel) {
        logChannel = await createModLogsChannel(client, guild, 'Created for AI moderation logs');

        // If channel creation failed, log to console and exit
        if (!logChannel) {
            if (config.logging.consoleLog) {
                console.log(`Action: ${action.toUpperCase()} against ${member.user.tag} for: ${reason}`);
            }
            return;
        }
    } else if (!logChannel) {
        // No log channel and not configured to create one
        if (config.logging.consoleLog) {
            console.log(`No log channel found. Action: ${action.toUpperCase()} against ${member.user.tag} for: ${reason}`);
        }
        return;
    }

    // Choose color and emoji based on action severity
    let actionColor = config.appearance.colors.warning;
    let actionEmoji = '🛡️';

    switch (action.toLowerCase()) {
        case 'timeout (1 hour)':
            actionColor = config.appearance.colors.lowSeverity;
            actionEmoji = '⏱️';
            break;
        case 'timeout (24 hours)':
            actionColor = config.appearance.colors.warning;
            actionEmoji = '⏱️';
            break;
        case 'kick':
            actionColor = config.appearance.colors.mediumSeverity;
            actionEmoji = '👢';
            break;
        case 'ban':
            actionColor = config.appearance.colors.error;
            actionEmoji = '🔨';
            break;
        default:
            actionColor = config.appearance.colors.warning;
            actionEmoji = '🛡️';
    }

    // Get member's warnings count
    const warnings = getUserWarnings(member.id);
    const warningCount = warnings ? warnings.count : 0;

    // Get account age
    const creationDate = new Date(member.user.createdAt);
    const now = new Date();
    const accountAgeDays = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24));
    const joinDate = new Date(member.joinedAt);
    const serverAgeDays = Math.floor((now - joinDate) / (1000 * 60 * 60 * 24));

    const logEmbed = new EmbedBuilder()
        .setColor(actionColor)
        .setTitle(`${actionEmoji} Moderation Action: ${action.toUpperCase()}`)
        .setDescription(`Action taken against ${member.user.tag} (${member.id})`)
        .addFields(
            { name: '👤 User', value: `${member.user.tag} (<@${member.id}>)` },
            { name: '🔨 Action', value: action.toUpperCase(), inline: true },
            { name: '⚠️ Warnings', value: `${warningCount}`, inline: true },
            { name: '📝 Reason', value: reason },
            { name: '🕒 Account Info', value: `Account Age: ${accountAgeDays} days\nServer Member: ${serverAgeDays} days` }
        )
        .setFooter({ text: `Moderator: ${client.user.tag} | AI Moderation` })
        .setTimestamp();

    // Include user avatar if available and configured
    if (config.appearance.showUserAvatarsInLogs && member.user.avatarURL()) {
        logEmbed.setThumbnail(member.user.avatarURL());
    }

    try {
        await logChannel.send({ embeds: [logEmbed] });
        if (config.logging.consoleLog) {
            console.log(`Successfully logged moderation action in ${logChannel.name}`);
        }
    } catch (sendError) {
        console.error(`Failed to send message to mod-logs channel: ${sendError}`);
    }
}

/**
 * Get a human-readable description of a moderation action
 * @param {string} action - The action code
 * @returns {string} - Descriptive text for the action
 */
export function getActionDescription(action) {
    switch (action) {
        case 'timeout_1h':
            return '⏱️ **Timeout (1 hour)** - You have been temporarily muted for 1 hour';
        case 'timeout_24h':
            return '⏱️ **Timeout (24 hours)** - You have been temporarily muted for 24 hours';
        case 'kick':
            return '👢 **Kicked** - You have been removed from the server but may rejoin with an invite';
        case 'ban':
            return '🔨 **Banned** - You have been permanently removed from the server';
        default:
            return `⚠️ **${action}**`;
    }
}

/**
 * Create a mod-logs channel in a guild
 * @param {Client} client - The Discord client
 * @param {Guild} guild - The guild to create the channel in
 * @param {string} reason - The reason for creating the channel
 * @returns {Promise<TextChannel|null>} - The created channel or null if failed
 */
export async function createModLogsChannel(client, guild, reason = 'AI moderation logs') {
    try {
        console.log(`Creating mod-logs channel in ${guild.name}...`);

        // Create a private channel that only admins and moderators can see
        const logChannel = await guild.channels.create({
            name: 'mod-logs',
            type: 0, // Text channel
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone role
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: client.user.id, // Bot's user ID
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ],
            reason: reason,
            topic: 'Automatic moderation logs - Do not delete this channel'
        });

        console.log(`Successfully created mod-logs channel in ${guild.name}`);

        // Set permissions for admin and mod roles
        try {
            const roles = guild.roles.cache.filter(role =>
                role.permissions.has(PermissionFlagsBits.Administrator) ||
                role.permissions.has(PermissionFlagsBits.ModerateMembers)
            );

            for (const [id, role] of roles) {
                await logChannel.permissionOverwrites.create(role, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                console.log(`Added permissions for role ${role.name} to mod-logs channel`);
            }
        } catch (permError) {
            console.error(`Error setting role permissions: ${permError}`);
            // Continue anyway, at least the bot has access
        }

        // Send an initialization message
        const initEmbed = new EmbedBuilder()
            .setColor(config.appearance.colors.info)
            .setTitle('🔄 Moderation System Initialized')
            .setDescription(`AI moderation system is now active in this server.`)
            .addFields(
                { name: '⚙️ Settings', value: `Sensitivity: ${config.moderation.sensitivity * 10}/10\nStrict Mode: ${config.moderation.strictMode ? "Enabled" : "Disabled"}` },
                { name: '📊 Monitoring', value: 'The bot will automatically moderate messages for inappropriate content.' }
            )
            .setFooter({ text: `${client.user.tag} | AI Moderation` })
            .setTimestamp();

        await logChannel.send({ embeds: [initEmbed] });

        return logChannel;
    } catch (error) {
        console.error(`Error creating mod-logs channel in ${guild.name}: ${error}`);

        // Try fallback method with simpler settings
        try {
            console.log(`Attempting to create fallback mod-logs channel in ${guild.name}...`);

            // Create a basic channel without complex permission overwrites
            const logChannel = await guild.channels.create({
                name: 'mod-logs',
                reason: `${reason} (fallback method)`
            });

            // Then try to set it to private after creation
            await logChannel.permissionOverwrites.create(guild.id, { ViewChannel: false });
            await logChannel.permissionOverwrites.create(client.user.id, { ViewChannel: true, SendMessages: true });

            console.log(`Created fallback mod-logs channel in ${guild.name}`);

            // Add permissions for admin roles in a simpler way
            const adminRole = guild.roles.cache.find(role =>
                role.permissions.has(PermissionFlagsBits.Administrator)
            );

            if (adminRole) {
                await logChannel.permissionOverwrites.create(adminRole, { ViewChannel: true });
            }

            // Send a simple initialization message
            const initEmbed = new EmbedBuilder()
                .setColor(config.appearance.colors.info)
                .setTitle('🔄 Moderation System Initialized')
                .setDescription(`AI moderation system is now active in this server.`)
                .setFooter({ text: `${client.user.tag} | AI Moderation` })
                .setTimestamp();

            await logChannel.send({ embeds: [initEmbed] });

            return logChannel;
        } catch (fallbackError) {
            console.error(`Failed to create fallback mod-logs channel: ${fallbackError}`);
            return null;
        }
    }
}

/**
 * Log a message moderation action to the mod-logs channel
 * @param {Client} client - The Discord client
 * @param {Guild} guild - The guild where the message was moderated
 * @param {GuildMember} member - The member whose message was moderated
 * @param {TextChannel} channel - The channel where the message was posted
 * @param {Object} modResult - The moderation result object
 * @param {Object} userData - The user's warning data
 * @param {string|null} recommendedAction - The recommended action to take
 * @param {string} messageContent - The content of the moderated message
 */
export async function logMessageModeration(client, guild, member, channel, modResult, userData, recommendedAction, messageContent) {
    // Find the mod logs channel
    let logChannel;

    for (const channelName of config.logging.modLogChannels) {
        const foundChannel = guild.channels.cache.find(
            ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
        );
        if (foundChannel) {
            logChannel = foundChannel;
            break;
        }
    }

    // If no log channel is found, create a private one if configured to do so
    if (!logChannel && config.logging.createLogChannel) {
        logChannel = await createModLogsChannel(client, guild, 'Created for AI moderation logs');

        // If channel creation failed, exit
        if (!logChannel) return;
    } else if (!logChannel) {
        // No log channel and not configured to create one
        return;
    }

    // Choose color based on severity
    let severityColor;
    switch (modResult.severity.toLowerCase()) {
        case 'high':
            severityColor = config.appearance.colors.highSeverity;
            break;
        case 'medium':
            severityColor = config.appearance.colors.mediumSeverity;
            break;
        case 'low':
            severityColor = config.appearance.colors.lowSeverity;
            break;
        default:
            severityColor = config.appearance.colors.warning;
    }

    // Create message log embed
    const logEmbed = new EmbedBuilder()
        .setColor(severityColor)
        .setTitle('🛡️ Message Moderated')
        .setDescription(`A message by ${member.user.tag} was removed from ${channel}.`)
        .addFields(
            { name: '👤 User', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
            { name: '📊 Warning Count', value: `${userData.count}`, inline: true },
            { name: '⚠️ Severity', value: modResult.severity.toUpperCase(), inline: true },
            { name: '📝 Reason', value: modResult.reason }
        )
        .setFooter({ text: `AI Moderation | User ID: ${member.id}` })
        .setTimestamp();

    // Include message content if configured
    if (config.logging.includeMessageContent && messageContent) {
        let contentToShow = messageContent;

        // Censor content if configured
        if (config.logging.censorMessageContent) {
            // Simple censoring by replacing potentially offensive words with asterisks
            // In a real implementation, use a more sophisticated filter
            contentToShow = contentToShow.replace(/(\w{1})(\w+)/g, (match, first, rest) => {
                return first + rest.replace(/./g, '*');
            });
        }

        // Truncate if too long
        const maxLength = config.logging.maxContentLength || 1024;
        if (contentToShow.length > maxLength) {
            contentToShow = contentToShow.substring(0, maxLength - 3) + '...';
        }

        logEmbed.addFields({ name: '📋 Message Content', value: contentToShow });
    }

    // Include user avatar if configured
    if (config.appearance.showUserAvatarsInLogs && member.user.avatarURL()) {
        logEmbed.setThumbnail(member.user.avatarURL());
    }

    // Add recommended action field if applicable
    if (recommendedAction) {
        logEmbed.addFields({
            name: '🔨 Recommended Action',
            value: getActionDescription(recommendedAction)
        });
    }

    try {
        await logChannel.send({ embeds: [logEmbed] });
        if (config.logging.consoleLog) {
            console.log(`Message moderation logged to ${logChannel.name}`);
        }
    } catch (error) {
        console.error(`Error sending message moderation log: ${error}`);
    }
}
