
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export default {
    data: new SlashCommandBuilder()
        .setName('modhelp')
        .setDescription('List all moderation commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages), // We handle custom perm check manually

    async execute(interaction, config) {
        // Permission check
        const allowedRolesEnv = process.env.REGISTER_ALLOWED_ROLES || '';
        const allowedRoles = allowedRolesEnv.split(',').map(r => r.trim()).filter(Boolean);

        const hasPermission = allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId)) ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasPermission) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(config?.appearance?.colors?.info || 0x0099FF)
            .setTitle('🛡️ Moderation Commands')
            .setDescription('List of available moderation and registry commands.')
            .addFields(
                { name: '📝 /register', value: 'Register a player with a 3-digit number.\nUsage: `/register user:@Player number:007`' },
                { name: '⚠️ /warnings', value: 'View warnings for a user.\nUsage: `/warnings user:@Player`' },
                { name: '🧹 /clearwarnings', value: 'Clear all warnings for a user.\nUsage: `/clearwarnings user:@Player`' },
                { name: '📊 /modstats', value: 'View server moderation statistics.\nUsage: `/modstats`' },
                { name: '💾 /forcesave', value: 'Force save all warning data (Admin only).\nUsage: `/forcesave`' }
            )
            .setFooter({ text: 'AI Moderation System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
