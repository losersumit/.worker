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
        .addAttachmentOption(opt =>
            opt.setName('photo')
                .setDescription('Profile photo to display on the website')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.options.getMember('member');
        const user = interaction.options.getUser('member');
        const roleTitle = interaction.options.getString('role_title');
        const section = interaction.options.getString('section');
        const photo = interaction.options.getAttachment('photo');

        // Use provided photo or fall back to Discord avatar
        const photoUrl = photo?.url || user.displayAvatarURL({ size: 512, extension: 'png' });

        if (photo && !photo.contentType?.startsWith('image/')) {
            return interaction.editReply('❌ Photo must be an image file.');
        }

        const displayName = member?.displayName || user.username;

        const { error } = await supabase.from('website_members').insert([{
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
