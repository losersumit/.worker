import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { supabase } from '../clients/supabase.js';

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

export default {
    data: new SlashCommandBuilder()
        .setName('addmedia')
        .setDescription('Add a photo or video to the NMC website media gallery')
        .addStringOption(opt =>
            opt.setName('message_link')
                .setDescription('Right-click a message → Copy Message Link (must have an image or video attached)')
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

        // Role check – ENLISTED_ROLE_ID or Administrator
        const enlistedRoleId = process.env.ENLISTED_ROLE_ID;
        const hasPermission = (enlistedRoleId && interaction.member.roles.cache.has(enlistedRoleId))
            || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        if (!hasPermission) {
            return interaction.editReply('❌ You do not have permission to use this command.');
        }

        const messageLink = interaction.options.getString('message_link');
        const description = interaction.options.getString('description');

        // Parse: https://discord.com/channels/GUILD/CHANNEL/MESSAGE
        const match = messageLink.match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
        if (!match) {
            return interaction.editReply('❌ Invalid message link. Right-click a message → **Copy Message Link**.');
        }
        const [, , channelId, messageId] = match;

        // Fetch the message to get the current fresh attachment URL
        let attachment;
        try {
            const channel = await interaction.client.channels.fetch(channelId);
            const message = await channel.messages.fetch(messageId);
            attachment = message.attachments.first();
        } catch (err) {
            console.error('[addmedia] Message fetch error:', err.message);
            return interaction.editReply('❌ Could not fetch that message. Make sure the bot has access to that channel.');
        }

        if (!attachment) {
            return interaction.editReply('❌ No attachment found in that message. The message must contain an image or video file.');
        }

        const filename = (attachment.name || '').toLowerCase();
        const mediaType = VIDEO_EXTS.some(ext => filename.endsWith(ext)) ? 'video' : 'image';

        const { error } = await supabase.from('media_gallery').insert([{
            channel_id: channelId,
            message_id: messageId,
            message_link: messageLink,
            media_url: attachment.url,
            media_type: mediaType,
            description: description,
            added_by: interaction.user.tag,
        }]);

        if (error) {
            console.error('[addmedia] Supabase error:', error);
            return interaction.editReply('❌ Failed to add media: ' + error.message);
        }

        const emoji = mediaType === 'video' ? '🎥 Video' : '🖼️ Image';
        return interaction.editReply(`✅ ${emoji} added to the NMC website gallery!`);
    }
};
