import { Events, EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { createModLogsChannel } from '../utils/moderationUtils.js';

export default {
    name: Events.GuildCreate,
    async execute(guild, client) {
        console.log(`Bot was added to a new server: ${guild.name}`);

        // Check if we should create a mod-logs channel
        if (config.logging.createLogChannel) {
            // Check if a mod-logs channel already exists
            let logChannelExists = false;

            for (const channelName of config.logging.modLogChannels) {
                const existingChannel = guild.channels.cache.find(
                    ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
                );

                if (existingChannel) {
                    logChannelExists = true;
                    console.log(`Found existing mod-logs channel in ${guild.name}: ${existingChannel.name}`);

                    // Send a welcome message to the existing channel
                    try {
                        const welcomeEmbed = new EmbedBuilder()
                            .setColor(config.appearance.colors.info)
                            .setTitle('🔄 AI Moderation Bot Added')
                            .setDescription(`Thank you for adding the AI Moderation Bot to your server!`)
                            .addFields(
                                { name: '⚙️ Settings', value: `Sensitivity: ${config.moderation.sensitivity * 10}/10\nStrict Mode: ${config.moderation.strictMode ? "Enabled" : "Disabled"}` },
                                { name: '📊 Status', value: 'The bot is now monitoring messages for inappropriate content.' }
                            )
                            .setFooter({ text: `${client.user.tag} | AI Moderation` })
                            .setTimestamp();

                        await existingChannel.send({ embeds: [welcomeEmbed] });
                    } catch (error) {
                        console.error(`Error sending welcome message to existing mod-logs channel: ${error}`);
                    }

                    break;
                }
            }

            // Create a new mod-logs channel if none exists
            if (!logChannelExists) {
                const channel = await createModLogsChannel(client, guild, 'Created for AI moderation logs (new server)');

                if (channel) {
                    console.log(`Created mod-logs channel in new server ${guild.name}`);
                } else {
                    console.error(`Failed to create mod-logs channel in new server ${guild.name}`);
                }
            }
        }
    },
};
