import { Events } from 'discord.js';
import config from '../config.js';
import { supabase } from '../clients/supabase.js';
import { trackTransaction } from '../utils/economyUtils.js';
import { resolveMessageFromLink } from '../utils/discordUtils.js';
import { handleEnlistmentApplication, executeApplicationAccept, executeApplicationReject, handlePromotionRequest } from '../features/enlistmentApp.js';
import { handleSlotMachineInteraction } from '../../../.economy/interactions/slotMachineInteraction.js';
import { handleRouletteTableInteraction } from '../../../.economy/interactions/rouletteTableInteraction.js';
import { handleTodoPagination } from '../features/todoCommands.js';
import { handleAgentConfirmation } from '../systems/confirmationHandler.js';

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
            } else if (interaction.customId.startsWith('agent_confirm:') || interaction.customId.startsWith('agent_cancel:')) {
                console.log('[Button] Identified as Agent Confirmation/Cancellation.');
                await handleAgentConfirmation(interaction, client);
            } else {
                console.log(`[Button] Unknown or handled elsewhere: ${interaction.customId}`);
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
            await interaction.editReply(`âœ… Removed the <@&${pingRoleId}> role from you.`);
        } else {
            await member.roles.add(pingRoleId);
            await interaction.editReply(`âœ… Assigned the <@&${pingRoleId}> role to you.`);
        }
    } catch (err) {
        console.error('Error toggling ping role:', err);
        await interaction.editReply('âŒ Failed to toggle the role. Please check my permissions.');
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
            return interaction.editReply('âŒ You are not Enlisted Driver, ask Commander to enlist you.');
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
            return interaction.editReply('âŒ You are not registered in the economy system.');
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
            return interaction.editReply('âŒ Could not fetch your balance.');
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
            return interaction.editReply(`âŒ Skin with code \`${skinCode}\` not found/unavailable.`);
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
            return interaction.editReply('âŒ Failed to deduct funds from your account.');
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
            return interaction.editReply('âŒ Failed to add skin to your inventory. Contact admin.');
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

            const messageOptions = { content: `Your **${skin.name}** skin has been delivered! âš™ï¸\nYou have 5 minutes to download it.` };
            if (extraContent) messageOptions.content += `\n\n${extraContent.trim()}`;
            if (files.length > 0) messageOptions.files = files;
            else if (!extraContent && fileLinks.length > 0) messageOptions.content += `\nLinks: ${fileLinks.join('\n')}`;

            const skinMessage = await dm.send(messageOptions);
            setTimeout(() => { skinMessage.delete().catch(err => console.error('Failed to delete skin message:', err)); }, 5 * 60 * 1000);
            await interaction.editReply(`âœ… **${skin.name}** purchased successfully! Check your DMs.`);
        } catch (dmError) {
            console.error('Failed to send DM:', dmError);
            await interaction.editReply(`âœ… **${skin.name}** purchased, but I couldn't DM you! Please unlock your DMs and try \`?send ${skinCode}\` in the economy bot to retrieve it.`);
        }
    } catch (error) {
        console.error('Error in handleBuySkin:', error);
        await interaction.editReply('âŒ An unexpected error occurred while processing your purchase.');
    }
}



