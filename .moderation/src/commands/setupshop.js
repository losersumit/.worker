import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('setupshop')
        .setDescription('Get or Create the Skin Shop Webhook')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. Fetch Existing Webhooks
            const webhooks = await interaction.channel.fetchWebhooks();

            // 2. Filter for a webhook created by THIS bot client
            const existingWebhook = webhooks.find(wh => wh.owner.id === interaction.client.user.id);

            if (existingWebhook) {
                await interaction.editReply({
                    content: `✅ **Webhook Already Exists!**\n\nI found a webhook created by me in this channel.\n\n**URL:**\n\`${existingWebhook.url}\`\n\n(Use this in your \`.env\` as \`SKIN_SHOP_WEBHOOK_URL\`)`
                });
                return;
            }

            // 3. Create Webhook if none found
            const webhook = await interaction.channel.createWebhook({
                name: 'Skin Shop Bot',
                avatar: interaction.client.user.displayAvatarURL(),
            });

            // 4. Reply with the new URL
            await interaction.editReply({
                content: `✅ **Webhook Created Successfully!**\n\nBecause this webhook was created by ME (the bot), I can receive button clicks from messages it sends.\n\n**Please copy this URL into your \`.env\` file:**\n\`SKIN_SHOP_WEBHOOK_URL=${webhook.url}\`\n\n(Replace the old Discohook URL with this one, then restart the bot.)`
            });

        } catch (error) {
            console.error('Error creating webhook:', error);
            await interaction.editReply({ content: `❌ Failed to create/retrieve webhook: ${error.message}` });
        }
    }
};
