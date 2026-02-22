import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('setwh')
        .setDescription('Get or Create a Webhook')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to create the webhook in')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const targetChannel = interaction.options.getChannel('channel');

        try {
            // 1. Fetch Existing Webhooks in the target channel
            const webhooks = await targetChannel.fetchWebhooks();

            // 2. Filter for a webhook created by THIS bot client
            const existingWebhook = webhooks.find(wh => wh.owner.id === interaction.client.user.id);

            if (existingWebhook) {
                await interaction.editReply({
                    content: `✅ **Webhook Already Exists in <#${targetChannel.id}>!**\n\nI found a webhook created by me in this channel.\n\n**URL:**\n\`${existingWebhook.url}\`\n\n(Use this in your \`.env\`)`
                });
                return;
            }

            // 3. Create Webhook if none found
            const webhook = await targetChannel.createWebhook({
                name: 'Bot Webhook',
                avatar: interaction.client.user.displayAvatarURL(),
            });

            // 4. Reply with the new URL
            await interaction.editReply({
                content: `✅ **Webhook Created Successfully in <#${targetChannel.id}>!**\n\nBecause this webhook was created by ME (the bot), I can receive button clicks from messages it sends.\n\n**Please copy this URL into your \`.env\` file:**\n\`NEW_WEBHOOK_URL=${webhook.url}\`\n\n(Replace the old URL with this one, then restart the bot.)`
            });

        } catch (error) {
            console.error('Error creating webhook:', error);
            await interaction.editReply({ content: `❌ Failed to create/retrieve webhook in <#${targetChannel.id}>: ${error.message}` });
        }
    }
};
