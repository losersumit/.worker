import { Events, EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { supabase } from '../clients/supabase.js';
import { trackTransaction } from '../utils/economyUtils.js';
import { resolveMessageFromLink } from '../utils/discordUtils.js';
import { handleEnlistmentApplication, executeApplicationAccept, executeApplicationReject, handlePromotionRequest } from '../features/enlistmentApp.js';
import { handleSlotMachineInteraction } from '../../../.economy/interactions/slotMachineInteraction.js';
import { handleRouletteTableInteraction } from '../../../.economy/interactions/rouletteTableInteraction.js';
import { handleTodoPagination } from '../features/todoCommands.js';
import { groqChatCompletion } from '../clients/groq.js';

export default {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        console.log(`[Interaction] Received interaction: ${interaction.type} from ${interaction.user.tag} (${interaction.user.id})`);

        if (interaction.isChatInputCommand()) {
            console.log(`[Command] ${interaction.commandName}`);
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`[Command] No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction, config);
                console.log(`[Command] ${interaction.commandName} executed successfully.`);
            } catch (error) {
                console.error(`[Command] Error executing ${interaction.commandName}`);
                console.error(error);

                const errorReply = {
                    content: 'There was an error while executing this command!',
                    ephemeral: true
                };

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorReply);
                } else {
                    await interaction.reply(errorReply);
                }
            }
            return;
        }

        if (interaction.isButton()) {
            console.log(`[Button] Clicked: ${interaction.customId}`);

            if (interaction.customId.startsWith('buy_skin_')) {
                console.log('[Button] Identified as Skin Purchase. Handling...');
                await handleBuySkin(interaction, client);
            } else if (interaction.customId.startsWith('slot_machine_')) {
                console.log('[Button] Identified as Permanent Slot Machine Interaction.');
                await handleSlotMachineInteraction(interaction, client);
            } else if (interaction.customId.startsWith('roulette_table_')) {
                console.log('[Button] Identified as Permanent Roulette Table Interaction.');
                await handleRouletteTableInteraction(interaction, client);
            } else if (interaction.customId === 'assign_ping_role') {
                console.log('[Button] Identified as Ping Role Assignment.');
                await handlePingRole(interaction);
            } else if (interaction.customId === 'open_application') {
                console.log('[Button] Identified as Enlistment Application.');
                await handleEnlistmentApplication(interaction);
            } else if (interaction.customId === 'promote_me') {
                console.log('[Button] Identified as Promotion Request.');
                await handlePromotionRequest(interaction);
            } else if (interaction.customId.startsWith('app_accept:')) {
                const parts = interaction.customId.split(':');
                const userId = parts[1];
                const officerKey = parts[2] || 'operator';
                console.log(`[Button] Application Accept for user ${userId}`);
                await executeApplicationAccept(interaction, userId, officerKey);
            } else if (interaction.customId.startsWith('app_reject:')) {
                const userId = interaction.customId.split(':')[1];
                console.log(`[Button] Application Reject for user ${userId}`);
                await executeApplicationReject(interaction, userId);
            } else if (interaction.customId.startsWith('todo_prev:') || interaction.customId.startsWith('todo_next:')) {
                console.log('[Button] Identified as Todo Pagination interaction.');
                await handleTodoPagination(interaction, client);
            } else if (interaction.customId.startsWith('know_more_gun:')) {
                console.log('[Button] Identified as Know More Gun interaction.');
                await handleKnowMoreGun(interaction, client);
            } else {
                console.log(`[Button] Unknown or handled elsewhere: ${interaction.customId}`);
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'add_skin_modal') {
                await handleAddSkinModal(interaction, client);
                return;
            }
        }
    },
};

async function handlePingRole(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }
    try {
        const pingRoleId = '1448226345887731823';
        const member = interaction.member;

        if (member.roles.cache.has(pingRoleId)) {
            await member.roles.remove(pingRoleId);
            await interaction.editReply(`✅ Removed the <@&${pingRoleId}> role from you.`);
        } else {
            await member.roles.add(pingRoleId);
            await interaction.editReply(`✅ Assigned the <@&${pingRoleId}> role to you.`);
        }
    } catch (err) {
        console.error('Error toggling ping role:', err);
        await interaction.editReply('❌ Failed to toggle the role. Please check my permissions.');
    }
}

async function handleBuySkin(interaction, client) {
    const skinCode = interaction.customId.replace('buy_skin_', '');
    console.log(`[BuySkin] Skin Code: ${skinCode}`);

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }

    try {
        const startRole = '1463184412937289973';
        console.log(`[BuySkin] Checking role: ${startRole}`);
        if (!interaction.member.roles.cache.has(startRole)) {
            console.log(`[BuySkin] Role check failed for user: ${interaction.user.tag}`);
            return interaction.editReply('❌ You are not Enlisted Driver, ask Commander to enlist you.');
        }

        // Retired Personnel cannot buy skins
        const RTD_ROLE_ID = process.env.RTD_ROLE_ID || '1499413282279129139';
        if (interaction.member.roles.cache.has(RTD_ROLE_ID)) {
            return interaction.editReply('❌ **Retired Personnel** cannot purchase skins.');
        }

        console.log('[BuySkin] Fetching player from DB...');
        const { data: player, error: playerError } = await supabase
            .from('players')
            .select('id')
            .eq('discord_id', interaction.user.id)
            .single();

        if (playerError || !player) {
            console.error('[BuySkin] Player Fetch Error:', playerError);
            return interaction.editReply('❌ You are not registered in the economy system.');
        }
        console.log(`[BuySkin] Player found: ID ${player.id}`);

        console.log('[BuySkin] Fetching stats...');
        const { data: stats, error: statsError } = await supabase
            .from('player_stats')
            .select('wallet')
            .eq('player_id', player.id)
            .single();

        if (statsError || !stats) {
            console.error('[BuySkin] Stats Fetch Error:', statsError);
            return interaction.editReply('❌ Could not fetch your balance.');
        }
        console.log(`[BuySkin] Balance: ${stats.wallet}`);

        console.log(`[BuySkin] Fetching skin details for code: ${skinCode}`);
        const { data: skin, error: skinError } = await supabase
            .from('skins')
            .select('*')
            .eq('code', skinCode)
            .single();

        if (skinError || !skin) {
            console.error('[BuySkin] Skin Fetch Error:', skinError);
            return interaction.editReply(`❌ Skin with code \`${skinCode}\` not found/unavailable.`);
        }
        console.log(`[BuySkin] Skin found: ${skin.name} | Price: ${skin.price}`);

        if (skin.roles_allowed && skin.roles_allowed.length > 0) {
            console.log('[BuySkin] Skin requires specific roles:', skin.roles_allowed);
            const rolesStr = typeof skin.roles_allowed === 'string' ? skin.roles_allowed : JSON.stringify(skin.roles_allowed);
            const requiredRoleIds = rolesStr.match(/\d+/g) || [];

            const SMO_ROLE_ID = process.env.SMO_ROLE_ID || '1475314856184778835';
            const FO_ROLE_ID = process.env.FO_ROLE_ID || '1475314865878077603';
            const O_ROLE_ID = process.env.O_ROLE_ID || '1475314870802055421';

            const userIsSMO = interaction.member.roles.cache.has(SMO_ROLE_ID);
            const userIsFO = interaction.member.roles.cache.has(FO_ROLE_ID);
            const userIsO = interaction.member.roles.cache.has(O_ROLE_ID);

            const userRankWeight = userIsSMO ? 3 : (userIsFO ? 2 : (userIsO ? 1 : 0));

            let hasRequiredRoles = true;
            for (const id of requiredRoleIds) {
                if (id === SMO_ROLE_ID || id === FO_ROLE_ID || id === O_ROLE_ID) {
                    const skinRankWeight = (id === SMO_ROLE_ID) ? 3 : ((id === FO_ROLE_ID) ? 2 : 1);
                    if (userRankWeight < skinRankWeight) {
                        hasRequiredRoles = false;
                        console.log(`[BuySkin] Insufficient rank for role: ${id}`);
                        break;
                    }
                } else {
                    if (!interaction.member.roles.cache.has(id)) {
                        hasRequiredRoles = false;
                        console.log(`[BuySkin] Missing required role: ${id}`);
                        break;
                    }
                }
            }

            if (!hasRequiredRoles) {
                console.log("[BuySkin] User does not have sufficient rank or required roles for the skin.");
                return interaction.editReply(`❌ You don't have the required rank or roles to purchase the **${skin.name}** skin.`);
            }
        }

        console.log('[BuySkin] Checking ownership...');
        const { data: ownedSkins } = await supabase
            .from('player_skins')
            .select('skin_code')
            .eq('player_id', player.id);

        const existingSkin = ownedSkins?.find(s => skinCode === s.skin_code || skinCode.startsWith(s.skin_code));
        if (existingSkin) {
            console.log(`[BuySkin] Already owned: ${existingSkin.skin_code}`);
            if (existingSkin.skin_code === skinCode) {
                return interaction.editReply(`❌ You already own the **${skin.name}** skin!`);
            }
            return interaction.editReply(`❌ You already own the **${existingSkin.skin_code}** set! Use \`?send ${skinCode}\` (in economy bot) or ask admin to get this skin.`);
        }

        if (stats.wallet < skin.price) {
            console.log(`[BuySkin] Insufficient funds. Needs ${skin.price}, has ${stats.wallet}`);
            return interaction.editReply(`❌ Insufficient balance! You need €${skin.price}, but you only have €${stats.wallet}.`);
        }

        console.log('[BuySkin] Deducting funds...');
        const newBalance = stats.wallet - skin.price;
        const { error: updateError } = await supabase
            .from('player_stats')
            .update({ wallet: newBalance })
            .eq('player_id', player.id);

        if (updateError) {
            console.error('[BuySkin] Deduction Error:', updateError);
            return interaction.editReply('❌ Failed to deduct funds from your account.');
        }

        console.log('[BuySkin] Adding to guild funds...');
        const { data: guild, error: guildError } = await supabase
            .from('approved_guilds')
            .select('guild_income')
            .eq('guild_id', interaction.guildId)
            .single();

        if (!guildError && guild) {
            const newGuildIncome = (parseFloat(guild.guild_income) || 0) + skin.price;
            await supabase.from('approved_guilds').update({ guild_income: newGuildIncome }).eq('guild_id', interaction.guildId);
        }

        console.log('[BuySkin] Adding to inventory...');
        const { error: addSkinError } = await supabase
            .from('player_skins')
            .insert([{ player_id: player.id, skin_code: skinCode }]);

        if (addSkinError) {
            console.error('[BuySkin] Inventory Add Error:', addSkinError);
            return interaction.editReply('❌ Failed to add skin to your inventory. Contact admin.');
        }

        console.log('[BuySkin] Tracking transaction...');
        await trackTransaction(supabase, player.id, 'buy', skin.price, `Bought skin: ${skin.name} (${skinCode})`, client);

        console.log('[BuySkin] Delivering content via DM...');
        try {
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

            const messageOptions = { content: `Your **${skin.name}** skin has been delivered! ⚙️ \nYou have 5 minutes to download it.` };
            if (extraContent) messageOptions.content += `\n\n${extraContent.trim()}`;
            if (files.length > 0) messageOptions.files = files;
            else if (!extraContent && fileLinks.length > 0) messageOptions.content += `\nLinks: ${fileLinks.join('\n')}`;

            const skinMessage = await dm.send(messageOptions);
            setTimeout(() => { skinMessage.delete().catch(err => console.error('Failed to delete skin message:', err)); }, 5 * 60 * 1000);
            await interaction.editReply(`✅ **${skin.name}** purchased successfully! Check your DMs.`);
        } catch (dmError) {
            console.error('Failed to send DM:', dmError);
            await interaction.editReply(`✅ **${skin.name}** purchased, but I couldn't DM you! Please unlock your DMs and try \`?send ${skinCode}\` in the economy bot to retrieve it.`);
        }
    } catch (error) {
        console.error('Error in handleBuySkin:', error);
        await interaction.editReply('❌ An unexpected error occurred while processing your purchase.');
    }
}

async function handleAddSkinModal(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const code = interaction.fields.getTextInputValue('skin_code').trim();
        const name = interaction.fields.getTextInputValue('skin_name').trim();
        const priceStr = interaction.fields.getTextInputValue('skin_price').trim();
        const filePath = interaction.fields.getTextInputValue('skin_file_path').trim();
        const rolesStr = interaction.fields.getTextInputValue('skin_roles_allowed').trim();

        // Validate price is a positive number
        const price = Number(priceStr);
        if (isNaN(price) || price < 0) {
            return interaction.editReply('❌ Price must be a valid non-negative number.');
        }

        // Parse roles allowed
        let rolesAllowed = [];
        if (rolesStr) {
            rolesAllowed = rolesStr.split(',').map(r => r.trim()).filter(r => r.length > 0);
        }

        // Insert into database
        const { error } = await supabase
            .from('skins')
            .insert({
                code,
                name,
                price,
                file_path: filePath,
                available: true,
                roles_allowed: rolesAllowed
            });

        if (error) {
            console.error('[AddSkin] Database Insert Error:', error);
            return interaction.editReply(`❌ Failed to add skin: ${error.message}`);
        }

        await interaction.editReply(`✅ Skin **${name}** (Code: \`${code}\`) has been added successfully!`);

    } catch (err) {
        console.error('[AddSkin] Error handling modal submit:', err);
        await interaction.editReply(`❌ An unexpected error occurred: ${err.message}`);
    }
}

async function handleKnowMoreGun(interaction, client) {
    // Defer publicly so everyone can see the response
    await interaction.deferReply({ ephemeral: false });

    // Parse gun name from button customId: "know_more_gun:<gun name>"
    const gun = interaction.customId.slice('know_more_gun:'.length);

    try {
        const aiResponse = await groqChatCompletion({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'user',
                    content: `Give me a brief 2-sentence description of the weapon "${gun}", followed by one truly amazing or surprising fact about it. Format your response exactly like this:\n**Description:** <2 sentences>\n**Amazing Fact:** <1 surprising fact>`
                }
            ]
        });

        const raw = aiResponse?.choices?.[0]?.message?.content?.trim() || 'Could not retrieve information.';

        // Parse out the two sections
        const descMatch = raw.match(/\*\*Description:\*\*\s*([\s\S]*?)(?=\*\*Amazing Fact:\*\*|$)/i);
        const factMatch = raw.match(/\*\*Amazing Fact:\*\*\s*([\s\S]*?)$/i);

        const description = descMatch ? descMatch[1].trim() : raw;
        const fact = factMatch ? factMatch[1].trim() : null;

        const embed = new EmbedBuilder()
            .setColor(0x1F1F1F)
            .setTitle(`🔫 ${gun}`)
            .setDescription(description)
            .setFooter({ text: 'Weapon Intel • Powered by AI' })
            .setTimestamp();

        if (fact) {
            embed.addFields({ name: '⚡ Amazing Fact', value: fact });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (err) {
        console.error('[KnowMoreGun] Groq error:', err);
        await interaction.editReply(`❌ Could not fetch info about **${gun}**: ${err.message}`);
    }
}
