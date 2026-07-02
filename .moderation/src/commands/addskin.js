import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('addskin')
        .setDescription('Add a new skin to the store')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only Administrators can use this command.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('add_skin_modal')
            .setTitle('Add New Skin');

        const codeInput = new TextInputBuilder()
            .setCustomId('skin_code')
            .setLabel('Skin Code (Unique)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., nmc_blue_beast')
            .setRequired(true);

        const nameInput = new TextInputBuilder()
            .setCustomId('skin_name')
            .setLabel('Skin Name')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., NMC Blue Beast')
            .setRequired(true);

        const priceInput = new TextInputBuilder()
            .setCustomId('skin_price')
            .setLabel('Price')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., 500')
            .setRequired(true);

        const filePathInput = new TextInputBuilder()
            .setCustomId('skin_file_path')
            .setLabel('File Path / Image URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., https://domain.com/skin.png')
            .setRequired(true);

        const rolesInput = new TextInputBuilder()
            .setCustomId('skin_roles_allowed')
            .setLabel('Allowed Role IDs (comma-separated, optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('e.g., 1475314856184778835, 1475314865878077603')
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(codeInput),
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(priceInput),
            new ActionRowBuilder().addComponents(filePathInput),
            new ActionRowBuilder().addComponents(rolesInput)
        );

        await interaction.showModal(modal);
    }
};
