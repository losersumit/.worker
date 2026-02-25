import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { supabase } from '../clients/supabase.js';

export default {
    data: new SlashCommandBuilder()
        .setName('addpartner')
        .setDescription('Add a partner server to the NMC website')
        .addStringOption(opt =>
            opt.setName('name')
                .setDescription('Partner server name')
                .setRequired(true)
        )
        .addAttachmentOption(opt =>
            opt.setName('logo')
                .setDescription('Partner server logo image (shown in the small box)')
                .setRequired(true)
        )
        .addAttachmentOption(opt =>
            opt.setName('background')
                .setDescription('Partner server background image (fills the full card)')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('description')
                .setDescription('Short description of the partner server')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const name = interaction.options.getString('name');
        const logo = interaction.options.getAttachment('logo');
        const background = interaction.options.getAttachment('background');
        const description = interaction.options.getString('description');

        // Validate they are images
        if (!logo.contentType?.startsWith('image/')) {
            return interaction.editReply('❌ Logo must be an image file.');
        }
        if (!background.contentType?.startsWith('image/')) {
            return interaction.editReply('❌ Background must be an image file.');
        }

        const { error } = await supabase.from('partners').insert([{
            name,
            description,
            logo_url: logo.url,
            bg_url: background.url,
        }]);

        if (error) {
            console.error('[addpartner] Supabase error:', error);
            return interaction.editReply('❌ Failed to add partner: ' + error.message);
        }

        return interaction.editReply(`✅ **${name}** has been added to the NMC website Partners section!`);
    }
};
