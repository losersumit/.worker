/**
 * Discord AI Moderation Bot - Commands
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserWarnings, resetWarnings, getServerStatistics } from '../systems/storage.js'; // Updated import
import enlist from "./enlist.js";
import modhelp from "./modhelp.js";
import setwh from "./setwh.js";
import addpartner from "./addpartner.js";
import adddriver from "./adddriver.js";
import addmedia from "./addmedia.js";


export const commands = [
    {
        data: new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('View warnings for a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to check warnings for')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

        async execute(interaction, config) {
            const user = interaction.options.getUser('user');
            const warnings = await getUserWarnings(user.id);

            if (!warnings || warnings.count === 0) {
                return interaction.reply({
                    content: `${user.tag} has no warnings.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const embed = new EmbedBuilder()
                .setColor(config.appearance.colors.info)
                .setTitle(`Warning History for ${user.tag}`)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'Total Warnings', value: `${warnings.count}`, inline: true },
                    { name: 'Last Warning', value: warnings.lastWarning ? formatDate(warnings.lastWarning) : 'N/A', inline: true }
                )
                .setFooter({ text: 'AI Moderation System' })
                .setTimestamp();

            // Add up to 10 most recent warnings
            if (warnings.warnings && warnings.warnings.length > 0) {
                const recentWarnings = warnings.warnings.slice(0, 10);
                let warningsText = '';
                recentWarnings.forEach((warning, index) => {
                    warningsText += `**${index + 1}.** ${formatDate(warning.timestamp)}\n`;
                    warningsText += `⟶ Reason: ${warning.reason}\n`;
                    warningsText += `⟶ Severity: ${warning.severity}\n\n`;
                });

                embed.addFields({ name: 'Recent Warnings', value: warningsText });
            }

            // Add actions taken
            if (warnings.actionsTaken && warnings.actionsTaken.length > 0) {
                let actionsText = '';
                warnings.actionsTaken.forEach((action, index) => {
                    actionsText += `**${index + 1}.** ${formatActionType(action.type)} - ${formatDate(action.timestamp)}\n`;
                });

                embed.addFields({ name: 'Actions Taken', value: actionsText });
            }

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }
    },

    {
        data: new SlashCommandBuilder()
            .setName('clearwarnings')
            .setDescription('Clear all warnings for a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('The user to clear warnings for')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

        async execute(interaction, config) {
            const user = interaction.options.getUser('user');
            const warnings = await getUserWarnings(user.id);

            if (!warnings || warnings.count === 0) {
                return interaction.reply({
                    content: `${user.tag} has no warnings to clear.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await resetWarnings(user.id, config);

            return interaction.reply({
                content: `Cleared all warnings for ${user.tag}.`,
                flags: MessageFlags.Ephemeral
            });
        }
    },

    {
        data: new SlashCommandBuilder()
            .setName('modstats')
            .setDescription('View moderation statistics')
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

        async execute(interaction, config) {
            const stats = await getServerStatistics(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setColor(config.appearance.colors.info)
                .setTitle('Moderation Statistics')
                .addFields(
                    { name: 'Total Users with Warnings', value: `${stats.activeUsers}`, inline: true },
                    { name: 'Total Warnings Issued', value: `${stats.totalWarnings}`, inline: true },
                    {
                        name: 'Actions Taken', value:
                            `Timeouts (1h): ${stats.actionsTaken.timeout1h}\n` +
                            `Timeouts (24h): ${stats.actionsTaken.timeout24h}\n` +
                            `Kicks: ${stats.actionsTaken.kick}\n` +
                            `Bans: ${stats.actionsTaken.ban}`
                    }
                )
                .setFooter({ text: 'AI Moderation System' })
                .setTimestamp();

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }
    },

    {
        data: new SlashCommandBuilder()
            .setName('purge')
            .setDescription('Delete a specified number of messages')
            .addIntegerOption(option =>
                option.setName('count')
                    .setDescription('Number of messages to delete (1-100)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(100)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

        async execute(interaction, config) {
            // Permission check using REGISTER_ALLOWED_ROLES
            const allowedRolesEnv = process.env.REGISTER_ALLOWED_ROLES || '';
            const allowedRoles = allowedRolesEnv.split(',').map(r => r.trim()).filter(Boolean);

            const hasPermission = allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId)) ||
                interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasPermission) {
                return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
            }

            const count = interaction.options.getInteger('count');

            try {
                await interaction.channel.bulkDelete(count, true); // true = filterOld (older than 14 days)
                return interaction.reply({
                    content: `🧹 Successfully purged ${count} messages.`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (err) {
                console.error('Purge error:', err);
                return interaction.reply({
                    content: '❌ Failed to delete messages. They might be older than 14 days.',
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },

    enlist,
    modhelp,
    setwh,
    addpartner,
    adddriver,
    addmedia
];

// Helper function to format dates
function formatDate(dateString) {
    const date = new Date(dateString);
    return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

// Helper function to format action types
function formatActionType(actionType) {
    switch (actionType) {
        case 'timeout_1h':
            return 'Timeout (1 hour)';
        case 'timeout_24h':
            return 'Timeout (24 hours)';
        case 'kick':
            return 'Kick';
        case 'ban':
            return 'Ban';
        default:
            return actionType;
    }
}
