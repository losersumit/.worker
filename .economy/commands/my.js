import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, ButtonBuilder, ButtonStyle } from 'discord.js';
import { resolveMessageFromLink } from '../utils/discordUtils.js';

export default {
    name: 'my',
    description: 'Check your personal items (skins, etc.)',
    async execute(message, args, client) {

        let subcommand = null;
        let targetArg = null;

        if (args.length > 0) {
            const firstArg = args[0].toLowerCase();
            if (firstArg === 'skins') {
                subcommand = 'skins';
            } else if (firstArg === 'info') {
                subcommand = 'info';
                targetArg = args[1] || null;
            } else {
                subcommand = 'info';
                targetArg = args[0];
            }
        }

        if (subcommand === 'skins') {
            await handleSkins(message, client, message.author.id, message.member?.displayName || message.author.username, false);
        } else if (subcommand === 'info') {
            // Resolve Target User & Member (supports mentions and ID inputs)
            let targetMember = message.member;
            if (message.mentions.members && message.mentions.members.size > 0) {
                targetMember = message.mentions.members.first();
            } else if (targetArg) {
                const possibleId = targetArg.replace(/[<@!>]/g, '');
                const fetched = await message.guild.members.fetch(possibleId).catch(() => null);
                if (fetched) targetMember = fetched;
            }
            const targetUser = targetMember?.user || message.author;
            await handleInfo(message, client, targetUser, targetMember, false);
        } else {
            // Send landing embed with two buttons "Skins" and "Info"
            const initialEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // Premium Blue
                .setTitle(`📁 Personal Registry & Skins`)
                .setDescription(`Welcome to your registry overview. Select a button below to view either your **Skins** or your **Personnel Info**.`)
                .setFooter({ text: `Requested by ${message.member?.displayName || message.author.username}` })
                .setTimestamp();

            const skinsBtn = new ButtonBuilder()
                .setCustomId('my_btn_skins')
                .setLabel('Skins')
                .setStyle(ButtonStyle.Primary);

            const infoBtn = new ButtonBuilder()
                .setCustomId('my_btn_info')
                .setLabel('Info')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(skinsBtn, infoBtn);

            const replyMessage = await message.reply({
                embeds: [initialEmbed],
                components: [row]
            });

            // Collector for the buttons
            const btnFilter = i => (i.customId === 'my_btn_skins' || i.customId === 'my_btn_info') && i.user.id === message.author.id;
            const btnCollector = replyMessage.createMessageComponentCollector({
                filter: btnFilter,
                componentType: ComponentType.Button,
                time: 300000 // 5 minutes
            });

            btnCollector.on('collect', async btnInteraction => {
                if (btnInteraction.customId === 'my_btn_skins') {
                    await handleSkins(btnInteraction, client, message.author.id, message.member?.displayName || message.author.username, true);
                } else if (btnInteraction.customId === 'my_btn_info') {
                    await handleInfo(btnInteraction, client, message.author, message.member, true);
                }
                btnCollector.stop();
            });

            btnCollector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        skinsBtn.setDisabled(true),
                        infoBtn.setDisabled(true)
                    );
                    replyMessage.edit({ components: [disabledRow] }).catch(() => { });
                }
            });
        }
    },
};

async function handleSkins(context, client, userId, displayName, isInteraction = false) {
    if (!isInteraction) {
        await context.channel.sendTyping();
    }
    try {
        // 1. Get player
        const { data: player, error: playerError } = await client.supabase
            .from('players')
            .select('id')
            .eq('discord_id', userId)
            .single();

        if (playerError || !player) {
            const msg = 'You are not registered in the economy system.';
            if (isInteraction) return context.update({ content: msg, embeds: [], components: [] });
            return context.reply(msg);
        }

        // 2. Fetch Skins
        const { data: ownedSkins, error: skinsError } = await client.supabase
            .from('player_skins')
            .select(`skin_code, skins ( name, file_path, roles_allowed )`)
            .eq('player_id', player.id);

        if (skinsError) {
            console.error(skinsError);
            const msg = 'Could not fetch your skins.';
            if (isInteraction) return context.update({ content: msg, embeds: [], components: [] });
            return context.reply(msg);
        }

        const hasSkins = ownedSkins && ownedSkins.length > 0;

        const skinList = hasSkins
            ? ownedSkins.map(s => `• ${s.skins.name} (\`${s.skin_code}\`)`).join('\n')
            : 'You do not own any skins.';

        const embed = new EmbedBuilder()
            .setColor(0x9B59B6) // Purple
            .setTitle(`${displayName}'s Skins`)
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

        let replyMessage;
        if (isInteraction) {
            replyMessage = await context.update({
                embeds: [embed],
                components: components,
                fetchReply: true
            });
        } else {
            replyMessage = await context.reply({
                embeds: [embed],
                components: components
            });
        }

        if (!hasSkins) return;

        // 3. Create Interaction Collector
        const filter = i => i.customId === 'select_skin_to_send' && i.user.id === userId;
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
                const skin = selectedSkin.skins;

                // 3.5 Check Roles
                const startRole = '1463184412937289973';
                if (!interaction.member.roles.cache.has(startRole)) {
                    return interaction.editReply('❌ You are not an Enlisted Driver, ask Commander to enlist you.');
                }

                if (skin.roles_allowed && skin.roles_allowed.length > 0) {
                    const rolesStr = typeof skin.roles_allowed === 'string' ? skin.roles_allowed : JSON.stringify(skin.roles_allowed);
                    const requiredRoleIds = rolesStr.match(/\d+/g) || [];

                    const SMO_ROLE_ID = process.env.SMO_ROLE_ID || '1475314856184778835';
                    const FO_ROLE_ID  = process.env.FO_ROLE_ID  || '1475314865878077603';
                    const O_ROLE_ID   = process.env.O_ROLE_ID   || '1475314870802055421';

                    const userIsSMO = interaction.member.roles.cache.has(SMO_ROLE_ID);
                    const userIsFO  = interaction.member.roles.cache.has(FO_ROLE_ID);
                    const userIsO   = interaction.member.roles.cache.has(O_ROLE_ID);

                    const userRankWeight = userIsSMO ? 3 : (userIsFO ? 2 : (userIsO ? 1 : 0));

                    let hasRequiredRoles = true;
                    for (const id of requiredRoleIds) {
                        if (id === SMO_ROLE_ID || id === FO_ROLE_ID || id === O_ROLE_ID) {
                            const skinRankWeight = (id === SMO_ROLE_ID) ? 3 : ((id === FO_ROLE_ID) ? 2 : 1);
                            if (userRankWeight < skinRankWeight) {
                                hasRequiredRoles = false;
                                break;
                            }
                        } else {
                            if (!interaction.member.roles.cache.has(id)) {
                                hasRequiredRoles = false;
                                break;
                            }
                        }
                    }

                    if (!hasRequiredRoles) {
                        return interaction.editReply(`❌ You no longer have the required rank or roles to retrieve the **${skin.name}** skin.`);
                    }
                }

                const dm = await interaction.user.createDM();
                const fileLinks = skin.file_path.split(',').map(s => s.trim()).filter(Boolean);

                let files = [];
                let extraContent = '';

                for (const link of fileLinks) {
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
                if (err.code === 50007) {
                    await interaction.editReply({ content: '❌ I could not DM you. Please enable your DMs for this server.' });
                } else {
                    await interaction.editReply({ content: '❌ An error occurred while sending the skin.' });
                }
            }
        });

        collector.on('end', () => {
            const disabledRow = new ActionRowBuilder().addComponents(
                components[0].components[0].setDisabled(true).setPlaceholder('Selection timed out')
            );
            replyMessage.edit({ components: [disabledRow] }).catch(() => { });
        });

    } catch (error) {
        console.error(error);
        if (isInteraction) {
            await context.followUp({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
        } else {
            context.reply('An error occurred.');
        }
    }
}

async function handleInfo(context, client, targetUser, targetMember, isInteraction = false) {
    if (!isInteraction) {
        await context.channel.sendTyping();
    }
    try {
        const displayName = targetMember?.displayName || targetUser.username;

        const [playerRes, driverRes, identityRes] = await Promise.all([
            client.supabase.from('players').select('id, registration_number, created_at, joined_at').eq('discord_id', targetUser.id).maybeSingle(),
            client.supabase.from('enlisted_drivers').select('unit_number, status, created_at').eq('discord_id', targetUser.id).maybeSingle(),
            client.supabase.from('verified_identities').select('message_count').eq('user_id', targetUser.id).maybeSingle()
        ]);

        const player = playerRes.data;
        const driver = driverRes.data;

        let msgCount = identityRes.data?.message_count;
        if (msgCount === undefined || msgCount === null) {
            const messageCountRes = await client.supabase.from('rag_messages').select('*', { count: 'exact', head: true }).eq('user_id', targetUser.id);
            msgCount = messageCountRes.count || 0;
        }

        let skinsCount = 0;
        let lastJobString = 'Never';
        let level = 1;

        if (player) {
            const [skinsRes, lastJobRes, statsRes] = await Promise.all([
                client.supabase.from('player_skins').select('*', { count: 'exact', head: true }).eq('player_id', player.id),
                client.supabase.from('runs').select('created_at').eq('player_id', player.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
                client.supabase.from('player_stats').select('level').eq('player_id', player.id).maybeSingle()
            ]);

            skinsCount = skinsRes.count || 0;
            if (lastJobRes.data) {
                const runDate = new Date(lastJobRes.data.created_at);
                const runTimestamp = Math.floor(runDate.getTime() / 1000);
                lastJobString = `<t:${runTimestamp}:F> (<t:${runTimestamp}:R>)`;
            }
            if (statsRes.data?.level) {
                level = statsRes.data.level;
            }
        }

        const unitNumber = driver?.unit_number || player?.registration_number || 'N/A';

        const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID || '1448029016844931143';
        const SMO_ROLE_ID = process.env.SMO_ROLE_ID || '1475314856184778835';
        const FO_ROLE_ID = process.env.FO_ROLE_ID || '1475314865878077603';
        const O_ROLE_ID = process.env.O_ROLE_ID || '1475314870802055421';
        const RTD_ROLE_ID = process.env.RTD_ROLE_ID || '1499413282279129139';
        const RP_ROLE_ID = process.env.RP_ROLE_ID || '1482059608536387795';

        const hasCommander = targetMember?.roles?.cache?.has(COMMANDER_ROLE_ID);
        const hasSMO = targetMember?.roles?.cache?.has(SMO_ROLE_ID);
        const hasFO = targetMember?.roles?.cache?.has(FO_ROLE_ID);
        const hasO = targetMember?.roles?.cache?.has(O_ROLE_ID);
        const hasRTD = targetMember?.roles?.cache?.has(RTD_ROLE_ID) || driver?.status === 'RTD';

        const isEnlisted = hasCommander || hasSMO || hasFO || hasO;
        const isRetired = !isEnlisted && hasRTD;
        const isVisitor = !isEnlisted && !isRetired;

        let statusText = 'N/A';
        if (isEnlisted) {
            if (targetMember?.roles?.cache?.has(RP_ROLE_ID) || driver?.status === 'RP') {
                statusText = '🟡 Reserved Personnel';
            } else {
                statusText = '🟢 Active Personnel';
            }
        } else if (isRetired) {
            statusText = '🔴 Retired Personnel';
        }

        let rankValue = 'Visitor';
        if (isEnlisted) {
            let rankName = 'Driver';
            if (hasCommander) rankName = 'Supreme Commander';
            else if (hasSMO) rankName = 'Senior Mobility Operator';
            else if (hasFO) rankName = 'Field Operator';
            else if (hasO) rankName = 'Operator';
            rankValue = `${rankName} (Lvl ${level})`;
        } else if (isRetired) {
            rankValue = 'Retired Driver';
        }

        let joinString = 'Unknown';
        let joinedDate = null;

        if (isVisitor) {
            if (targetMember?.joinedAt) {
                joinedDate = targetMember.joinedAt;
            }
        } else {
            if (driver?.created_at) {
                joinedDate = new Date(driver.created_at);
            } else if (player?.joined_at) {
                joinedDate = new Date(player.joined_at);
            } else if (player?.created_at) {
                joinedDate = new Date(player.created_at);
            } else if (targetMember?.joinedAt) {
                joinedDate = targetMember.joinedAt;
            }
        }

        if (joinedDate) {
            const joinTimestamp = Math.floor(joinedDate.getTime() / 1000);
            joinString = `<t:${joinTimestamp}:F> (<t:${joinTimestamp}:R>)`;
        }

        let retiredString = null;
        if (isRetired) {
            let retiredDate = null;
            if (identityRes.data?.date_retired) {
                retiredDate = new Date(identityRes.data.date_retired);
            } else {
                retiredDate = new Date('2026-03-31T00:00:00Z');
            }
            const retiredTimestamp = Math.floor(retiredDate.getTime() / 1000);
            retiredString = `<t:${retiredTimestamp}:F> (<t:${retiredTimestamp}:R>)`;
        }

        const embedFields = [
            { name: '🆔 Unit Number', value: `\`${unitNumber}\``, inline: true },
            { name: '🎖️ Rank', value: `\`${rankValue}\``, inline: true },
            { name: '📊 Status', value: statusText, inline: true }
        ];

        if (isVisitor) {
            embedFields.push({ name: '📅 Date Joined', value: joinString, inline: false });
        } else {
            embedFields.push({ name: '📅 Date Enlisted', value: joinString, inline: false });
            if (isRetired && retiredString) {
                embedFields.push({ name: '📅 Date Retired', value: retiredString, inline: false });
            }
        }

        embedFields.push(
            { name: '🛍️ Skins Bought', value: `\`${skinsCount} skin(s)\``, inline: true },
            { name: '💬 Messages Sent', value: `\`${msgCount.toLocaleString()} message(s)\``, inline: true },
            { name: '🚛 Last Active Job', value: lastJobString, inline: false }
        );

        const infoEmbed = new EmbedBuilder()
            .setColor(0x3498DB) // Premium Blue
            .setTitle(`📇 Personnel Information: ${displayName}`)
            .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256, dynamic: true }))
            .addFields(embedFields)
            .setFooter({ text: `NMC Registry • Requested by ${context.member?.displayName || (isInteraction ? context.user.username : context.author.username)}` })
            .setTimestamp();

        if (isInteraction) {
            await context.update({ embeds: [infoEmbed], components: [] });
        } else {
            await context.reply({ embeds: [infoEmbed] });
        }

    } catch (err) {
        console.error('Error fetching personnel info:', err);
        const msg = '❌ An error occurred while retrieving driver profile.';
        if (isInteraction) {
            await context.update({ content: msg, embeds: [], components: [] }).catch(() => {});
        } else {
            context.reply(msg);
        }
    }
}
