import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { supabase } from '../clients/supabase.js';

export default {
    data: new SlashCommandBuilder()
        .setName('addmedia')
        .setDescription('Add a photo or video to the NMC website media gallery')
        .addAttachmentOption(opt =>
            opt.setName('media')
                .setDescription('The photo or video to upload')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('description')
                .setDescription('Caption / description for this media')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Role check – must have ENLISTED_ROLE_ID or be an Administrator
        const enlistedRoleId = process.env.ENLISTED_ROLE_ID;
        const hasPermission = (enlistedRoleId && interaction.member.roles.cache.has(enlistedRoleId))
            || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return interaction.editReply('❌ You do not have permission to use this command.');
        }

        const media = interaction.options.getAttachment('media');
        const description = interaction.options.getString('description');

        const isVideo = media.contentType?.startsWith('video/');
        const isImage = media.contentType?.startsWith('image/');

        if (!isImage && !isVideo) {
            return interaction.editReply('❌ Only image or video files are supported.');
        }

        const { error } = await supabase.from('media_gallery').insert([{
            media_url: media.url,
            media_type: isVideo ? 'video' : 'image',
            description: description,
            added_by: interaction.user.tag,
        }]);

        if (error) {
            console.error('[addmedia] Supabase error:', error);
            return interaction.editReply('❌ Failed to add media: ' + error.message);
        }

        return interaction.editReply('✅ Media added to the NMC website gallery!');
    }
};
