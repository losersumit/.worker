import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { supabase } from '../clients/supabase.js';

export default {
    data: new SlashCommandBuilder()
        .setName('adddriver')
        .setDescription('Add an NMC Officer or Driver to the website')
        .addUserOption(opt =>
            opt.setName('member')
                .setDescription('Discord member to add')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('role_title')
                .setDescription('Their role title (e.g. Commander, NMC Officer, Truck Driver)')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('section')
                .setDescription('Which section to put them in')
                .setRequired(true)
                .addChoices(
                    { name: 'NMC Officer', value: 'officer' },
                    { name: 'Driver', value: 'driver' }
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Role check – must have one of REGISTER_ALLOWED_ROLES or be an Administrator
        const allowedRoles = (process.env.REGISTER_ALLOWED_ROLES || '')
            .split(',').map(r => r.trim()).filter(Boolean);
        const hasPermission = allowedRoles.some(id => interaction.member.roles.cache.has(id))
            || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return interaction.editReply('❌ You do not have permission to use this command.');
        }

        const member = interaction.options.getMember('member');
        const user = interaction.options.getUser('member');
        const roleTitle = interaction.options.getString('role_title');
        const section = interaction.options.getString('section');
        // Always use the member's Discord avatar (size 512, PNG)
        const photoUrl = user.displayAvatarURL({ size: 512, extension: 'png' });

        const displayName = member?.displayName || user.username;

        const { error } = await supabase.from('website_members').insert([{
            discord_id: user.id,
            display_name: displayName,
            role_title: roleTitle,
            photo_url: photoUrl,
            section: section,
        }]);

        if (error) {
            console.error('[adddriver] Supabase error:', error);
            return interaction.editReply('❌ Failed to add member: ' + error.message);
        }

        const sectionLabel = section === 'officer' ? 'NMC Officers' : 'Drivers';
        return interaction.editReply(`✅ **${displayName}** (${roleTitle}) added to the **${sectionLabel}** section on the website!`);
    }
};
