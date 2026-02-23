import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } from 'discord.js';
import { resolveMessageFromLink } from '../utils/discordUtils.js';

export default {
    name: 'my',
    description: 'Check your personal items (skins, etc.)',
    async execute(message, args, client) {

        if (args.length < 1) {
            return message.reply('Usage: `?my <skins>`');
        }

        const subcommand = args[0].toLowerCase();

        if (subcommand === 'skins') {
            await message.channel.sendTyping();
            try {
                // 1. Get player
                const { data: player, error: playerError } = await client.supabase
                    .from('players')
                    .select('id')
                    .eq('discord_id', message.author.id)
                    .single();

                if (playerError || !player) {
                    return message.reply('You are not registered in the economy system.');
                }

                // 2. Fetch Skins
                // Added file_path and roles_allowed to the select query so we can send it and verify later
                const { data: ownedSkins, error: skinsError } = await client.supabase
                    .from('player_skins')
                    .select(`skin_code, skins ( name, file_path, roles_allowed )`)
                    .eq('player_id', player.id);

                if (skinsError) {
                    console.error(skinsError);
                    return message.reply('Could not fetch your skins.');
                }

                const hasSkins = ownedSkins && ownedSkins.length > 0;

                const skinList = hasSkins
                    ? ownedSkins.map(s => `• ${s.skins.name} (\`${s.skin_code}\`)`).join('\n')
                    : 'You do not own any skins.';

                const embed = new EmbedBuilder()
                    .setColor(0x9B59B6) // Purple
                    .setTitle(`${message.author.username}'s Skins`)
                    .setDescription(skinList)
                    .setFooter({ text: 'Select a skin below to have it sent to your DMs.' })
                    .setTimestamp();

                const components = [];

                if (hasSkins) {
                    // Create Dropdown
                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('select_skin_to_send')
                        .setPlaceholder('Select a skin to download...')
                        .addOptions(
                            ownedSkins.slice(0, 25).map(s => ({
                                label: s.skins.name,
                                description: `Code: ${s.skin_code}`,
                                value: s.skin_code
                            }))
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    components.push(row);
                }

                const replyMessage = await message.reply({
                    embeds: [embed],
                    components: components
                });

                if (!hasSkins) return;

                // 3. Create Interaction Collector
                const filter = i => i.customId === 'select_skin_to_send' && i.user.id === message.author.id;
                const collector = replyMessage.createMessageComponentCollector({
                    filter,
                    componentType: ComponentType.StringSelect,
                    time: 300000 // 5 minutes 
                });

                collector.on('collect', async interaction => {
                    const selectedCode = interaction.values[0];
                    const selectedSkin = ownedSkins.find(s => s.skin_code === selectedCode);

                    if (!selectedSkin) {
                        return interaction.reply({ content: '❌ Error: Skin not found in your list.', ephemeral: true });
                    }

                    await interaction.deferReply({ ephemeral: true });

                    try {
                        // Send logic (copied/adapted from buy logic)
                        const skin = selectedSkin.skins;

                        // 3.5 Check Roles
                        // Enlisted Check (Hardcoded base check)
                        const startRole = '1463184412937289973';
                        if (!interaction.member.roles.cache.has(startRole)) {
                            return interaction.editReply('❌ You are not an Enlisted Driver, ask Commander to enlist you.');
                        }

                        // Specific Roles Check (from DB array)
                        if (skin.roles_allowed && skin.roles_allowed.length > 0) {
                            const requiredRoleIds = skin.roles_allowed
                                .flatMap(roleId => typeof roleId === 'string' ? roleId.split(',').map(id => id.trim()) : [roleId])
                                .filter(Boolean);

                            let hasAllRequiredRoles = true;
                            for (const id of requiredRoleIds) {
                                if (!interaction.member.roles.cache.has(id)) {
                                    hasAllRequiredRoles = false;
                                    break;
                                }
                            }

                            if (!hasAllRequiredRoles) {
                                return interaction.editReply(`❌ You lost or do not have all the required roles to use the **${skin.name}** skin.`);
                            }
                        }

                        const dm = await interaction.user.createDM();

                        // Handle multiple links separated by comma
                        const fileLinks = skin.file_path.split(',').map(s => s.trim()).filter(Boolean);

                        let files = [];
                        let extraContent = '';

                        for (const link of fileLinks) {
                            // Resolve Message Link if applicable
                            if (link.includes('discord.com/channels/')) {
                                const resolution = await resolveMessageFromLink(client, link);
                                if (resolution) {
                                    extraContent += `\n${resolution.content}`;
                                    files.push(...resolution.files);
                                } else {
                                    extraContent += `\nSource Link: ${link}`;
                                }
                            } else if (link.startsWith('http')) {
                                files.push(link);
                            } else {
                                extraContent += `\n${link}`;
                            }
                        }

                        const messageOptions = {
                            content: `Here is your **${skin.name}** skin! 📂`,
                        };

                        if (extraContent) {
                            messageOptions.content += `\n\n${extraContent.trim()}`;
                        }

                        if (files.length > 0) {
                            messageOptions.files = files;
                        } else if (!extraContent && fileLinks.length > 0) {
                            messageOptions.content += `\nLinks: ${fileLinks.join('\n')}`;
                        }

                        await dm.send(messageOptions);
                        await interaction.editReply({ content: `✅ **${skin.name}** has been sent to your DMs!` });

                    } catch (err) {
                        console.error('Error sending skin DM:', err);
                        if (err.code === 50007) { // Cannot send messages to this user
                            await interaction.editReply({ content: '❌ I could not DM you. Please enable your DMs for this server.' });
                        } else {
                            await interaction.editReply({ content: '❌ An error occurred while sending the skin.' });
                        }
                    }
                });

                collector.on('end', () => {
                    // Disable the select menu after timeout
                    const disabledRow = new ActionRowBuilder().addComponents(
                        components[0].components[0].setDisabled(true).setPlaceholder('Selection timed out')
                    );
                    replyMessage.edit({ components: [disabledRow] }).catch(() => { });
                });

            } catch (error) {
                console.error(error);
                message.reply('An error occurred.');
            }
        } else {
            message.reply('Unknown subcommand. Try `?my skins`.');
        }
    },
};
