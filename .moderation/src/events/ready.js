import { Events, REST, Routes, EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { commands } from '../commands/index.js';
import { initStorage, saveCountingState, getServerStatistics } from '../systems/storage.js';
import { setupStatusRotation } from '../utils/statusRotation.js';
import { createModLogsChannel } from '../utils/moderationUtils.js';

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);
        console.log(`Monitoring messages with sensitivity level: ${config.moderation.sensitivity * 10}/10`);
        console.log(`Strict mode: ${config.moderation.strictMode ? "ENABLED" : "DISABLED"}`);
        console.log(`Using Groq model: ${config.ai.model}`);

        // Initialize the storage system
        await initStorage(config);
        console.log('Storage system initialized');

        // Set up status rotation
        setupStatusRotation(client);

        // Register slash commands
        try {
            console.log('Started refreshing application (/) commands.');

            const commandsData = commands.map(command => command.data.toJSON());
            const rest = new REST().setToken(process.env.DISCORD_TOKEN);

            // Deploy commands to all guilds the bot is in
            await Promise.all(client.guilds.cache.map(async guild => {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(client.user.id, guild.id),
                        { body: commandsData },
                    );
                    console.log(`Successfully registered commands in guild: ${guild.name}`);
                } catch (error) {
                    console.error(`Failed to register commands in guild ${guild.name}:`, error);
                }
            }));

            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }

        // Check for mod-logs channels in all guilds if configured to create them
        if (config.logging.createLogChannel) {
            console.log(`Checking for mod-logs channels in all servers...`);

            client.guilds.cache.forEach(async (guild) => {
                try {
                    // Check if a mod-logs channel already exists
                    let logChannelExists = false;

                    for (const channelName of config.logging.modLogChannels) {
                        const existingChannel = guild.channels.cache.find(
                            ch => ch.name.toLowerCase() === channelName && ch.isTextBased()
                        );

                        if (existingChannel) {
                            logChannelExists = true;
                            console.log(`Found existing mod-logs channel in ${guild.name}: ${existingChannel.name}`);

                            // Send statistics to the mod-logs channel
                            try {
                                const stats = await getServerStatistics(guild.id);
                                const statsEmbed = new EmbedBuilder()
                                    .setColor(config.appearance.colors.info)
                                    .setTitle('📊 Moderation Statistics')
                                    .setDescription(`AI moderation system has been restarted.`)
                                    .addFields(
                                        { name: '👥 Active Users', value: `${stats.activeUsers}`, inline: true },
                                        { name: '⚠️ Total Warnings', value: `${stats.totalWarnings}`, inline: true },
                                        {
                                            name: '🔨 Actions Taken', value:
                                                `Timeouts (1h): ${stats.actionsTaken.timeout1h}\n` +
                                                `Timeouts (24h): ${stats.actionsTaken.timeout24h}\n` +
                                                `Kicks: ${stats.actionsTaken.kick}\n` +
                                                `Bans: ${stats.actionsTaken.ban}`
                                        }
                                    )
                                    .setFooter({ text: `${client.user.tag} | AI Moderation` })
                                    .setTimestamp();

                                await existingChannel.send({ embeds: [statsEmbed] });
                            } catch (statsError) {
                                console.error(`Error sending statistics to mod-logs channel: ${statsError}`);
                            }

                            break;
                        }
                    }

                    // Create mod-logs channel if it doesn't exist
                    if (!logChannelExists) {
                        await createModLogsChannel(client, guild, 'Created for AI moderation logs (initialization)');
                    }
                } catch (guildError) {
                    console.error(`Error processing guild ${guild.name}: ${guildError}`);
                }
            });
        }

        // ===== Counting Channel Persistence =====
        const countingChannelId = process.env.COUNTING_CHANNEL_ID;
        if (countingChannelId) {
            try {
                const channel = await client.channels.fetch(countingChannelId);
                if (channel && channel.isTextBased()) {
                    const messages = await channel.messages.fetch({ limit: 1 });
                    const lastMessage = messages.first();

                    if (lastMessage) {
                        let newCount = 0;
                        let lastUser = null;

                        // Case 1: Bot saying "Starting again from 1"
                        if (lastMessage.author.bot && lastMessage.content.includes("Starting again from 1")) {
                            newCount = 0;
                            lastUser = null;
                            console.log(`Counting Persistence: Found reset message. Starting from 0.`);
                        }
                        // Case 2: User number
                        else {
                            const number = parseInt(lastMessage.content);
                            if (!isNaN(number)) {
                                newCount = number;
                                lastUser = lastMessage.author.id;
                                console.log(`Counting Persistence: Found valid number ${newCount} from ${lastMessage.author.tag}`);
                            } else {
                                // Could be a bot message or conversation. 
                                // If it's the bot, and not a reset, maybe we shouldn't change anything?
                                // But if we restart, file might say 0.
                                // Let's rely on what's visually there.
                                console.log(`Counting Persistence: Last message '${lastMessage.content}' is not a number. Keep internal state or reset? Keeping current file state.`);
                                // If we return here, we keep whatever loadCountingState() loaded from file (which might be stale but better than 0).
                            }
                        }

                        // Only update if we found something meaningful
                        if (newCount > 0 || (lastMessage.author.bot && lastMessage.content.includes("Starting again from 1"))) {
                            // We must manually update the state
                            await saveCountingState({ currentCount: newCount, lastUserId: lastUser });
                        }

                    }
                }
            } catch (err) {
                console.error("Error initializing counting channel:", err);
            }
        }
    },
};
