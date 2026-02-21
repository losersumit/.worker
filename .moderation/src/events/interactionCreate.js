import { Events } from 'discord.js';
import config from '../config.js';
import { supabase } from '../clients/supabase.js';
import { trackTransaction } from '../utils/economyUtils.js';
import { resolveMessageFromLink } from '../utils/discordUtils.js';

export default {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        console.log(`[Interaction] Received interaction: ${interaction.type} from ${interaction.user.tag} (${interaction.user.id})`);

        // Handle Chat Input Commands
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

        // Handle Button Interactions
        if (interaction.isButton()) {
            console.log(`[Button] Clicked: ${interaction.customId}`);

            if (interaction.customId.startsWith('buy_skin_')) {
                console.log(`[Button] Identified as Skin Purchase. Handling...`);
                await handleBuySkin(interaction, client);
            } else {
                console.log(`[Button] Unknown or handled elsewhere: ${interaction.customId}`);
            }
        }
    },
};

async function handleBuySkin(interaction, client) {
    const skinCode = interaction.customId.replace('buy_skin_', '');
    console.log(`[BuySkin] Skin Code: ${skinCode}`);

    // Defer reply immediately to prevent timeout, make it ephemeral
    await interaction.deferReply({ ephemeral: true });

    try {
        // 1. Check Role Requirement
        const startRole = '1463184412937289973';
        console.log(`[BuySkin] Checking role: ${startRole}`);
        if (!interaction.member.roles.cache.has(startRole)) {
            console.log(`[BuySkin] Role check failed for user: ${interaction.user.tag}`);
            return interaction.editReply('❌ You are not Enlisted Driver, ask Commander to enlist you.');
        }

        // 2. Get Player from DB
        console.log(`[BuySkin] Fetching player from DB...`);
        const { data: player, error: playerError } = await supabase
            .from('players')
            .select('id')
            .eq('discord_id', interaction.user.id)
            .single();

        if (playerError || !player) {
            console.error(`[BuySkin] Player Fetch Error:`, playerError);
            return interaction.editReply('❌ You are not registered in the economy system.');
        }
        console.log(`[BuySkin] Player found: ID ${player.id}`);

        // 3. Get Player Stats (Balance)
        console.log(`[BuySkin] Fetching stats...`);
        const { data: stats, error: statsError } = await supabase
            .from('player_stats')
            .select('total_income')
            .eq('player_id', player.id)
            .single();

        if (statsError || !stats) {
            console.error(`[BuySkin] Stats Fetch Error:`, statsError);
            return interaction.editReply('❌ Could not fetch your balance.');
        }
        console.log(`[BuySkin] Balance: ${stats.total_income}`);

        // 4. Get Skin Details
        console.log(`[BuySkin] Fetching skin details for code: ${skinCode}`);
        const { data: skin, error: skinError } = await supabase
            .from('skins')
            .select('*')
            .eq('code', skinCode)
            .single();

        if (skinError || !skin) {
            console.error(`[BuySkin] Skin Fetch Error:`, skinError);
            return interaction.editReply(`❌ Skin with code \`${skinCode}\` not found/unavailable.`);
        }
        console.log(`[BuySkin] Skin found: ${skin.name} | Price: ${skin.price}`);

        // 5. Check if already owned or base version owned
        console.log(`[BuySkin] Checking ownership...`);
        const { data: ownedSkins } = await supabase
            .from('player_skins')
            .select('skin_code')
            .eq('player_id', player.id);

        const existingSkin = ownedSkins?.find(s =>
            skinCode === s.skin_code || skinCode.startsWith(s.skin_code)
        );

        if (existingSkin) {
            console.log(`[BuySkin] Already owned: ${existingSkin.skin_code}`);
            if (existingSkin.skin_code === skinCode) {
                return interaction.editReply(`❌ You already own the **${skin.name}** skin!`);
            }
            return interaction.editReply(`❌ You already own the **${existingSkin.skin_code}** set! Use \`?send ${skinCode}\` (in economy bot) or ask admin to get this skin.`);
        }

        // 6. Check Balance
        if (stats.total_income < skin.price) {
            console.log(`[BuySkin] Insufficient funds. Needs ${skin.price}, has ${stats.total_income}`);
            return interaction.editReply(`❌ Insufficient balance! You need $${skin.price}, but you only have $${stats.total_income}.`);
        }

        // 7. Deduct from Player Account
        console.log(`[BuySkin] Deducting funds...`);
        const newBalance = stats.total_income - skin.price;
        const { error: updateError } = await supabase
            .from('player_stats')
            .update({ total_income: newBalance })
            .eq('player_id', player.id);

        if (updateError) {
            console.error(`[BuySkin] Deduction Error:`, updateError);
            return interaction.editReply('❌ Failed to deduct funds from your account.');
        }

        // 8. Add to Guild Account
        // Note: interaction.guildId is available.
        console.log(`[BuySkin] Adding to guild funds...`);
        const { data: guild, error: guildError } = await supabase
            .from('approved_guilds')
            .select('guild_income')
            .eq('guild_id', interaction.guildId)
            .single();

        if (!guildError && guild) {
            const newGuildIncome = (parseFloat(guild.guild_income) || 0) + skin.price;
            await supabase
                .from('approved_guilds')
                .update({ guild_income: newGuildIncome })
                .eq('guild_id', interaction.guildId);
        }

        // 9. Add Skin to Inventory
        console.log(`[BuySkin] Adding to inventory...`);
        const { error: addSkinError } = await supabase
            .from('player_skins')
            .insert([{ player_id: player.id, skin_code: skinCode }]);

        if (addSkinError) {
            console.error(`[BuySkin] Inventory Add Error:`, addSkinError);
            // Refund? Complex. We'll just error for now, manual fix needed if this happens.
            return interaction.editReply('❌ Failed to add skin to your inventory. Contact admin.');
        }

        // 10. Track Transaction
        // Pass supabase client to trackTransaction
        console.log(`[BuySkin] Tracking transaction...`);
        await trackTransaction(
            supabase,
            player.id,
            'buy',
            skin.price,
            `Bought skin: ${skin.name} (${skinCode})`
        );

        // 11. Delivery (DM)
        console.log(`[BuySkin] Delivering content via DM...`);
        try {
            const dm = await interaction.user.createDM();

            // Handle multiple links separated by comma
            const fileLinks = skin.file_path.split(',').map(s => s.trim()).filter(Boolean);

            let files = [];
            let extraContent = '';

            for (const link of fileLinks) {
                // Resolve Message Link if applicable
                if (link.includes('discord.com/channels/')) {
                    console.log(`[BuySkin] Resolving message link: ${link}`);
                    const resolution = await resolveMessageFromLink(client, link);
                    if (resolution) {
                        extraContent += `\n${resolution.content}`;
                        files.push(...resolution.files);
                        console.log(`[BuySkin] Resolved with ${resolution.files.length} files.`);
                    } else {
                        console.warn(`[BuySkin] Could not resolve message for skin: ${skin.name} (${skin.code}) - Link: ${link}`);
                        extraContent += `\nSource Link: ${link}`;
                    }
                } else if (link.startsWith('http')) {
                    files.push(link);
                } else {
                    extraContent += `\n${link}`;
                }
            }

            const messageOptions = {
                content: `Your **${skin.name}** skin has been delivered! ⚙️\nYou have 5 minutes to download it.`,
            };

            if (extraContent) {
                messageOptions.content += `\n\n${extraContent.trim()}`;
            }

            if (files.length > 0) {
                messageOptions.files = files;
            } else if (!extraContent && fileLinks.length > 0) {
                // Fallback if no specific content but links exist (unlikely given logic above)
                messageOptions.content += `\nLinks: ${fileLinks.join('\n')}`;
            }

            const skinMessage = await dm.send(messageOptions);
            console.log(`[BuySkin] DM sent.`);

            // Auto-delete after 5 mins
            setTimeout(() => {
                skinMessage.delete().catch(err => console.error('Failed to delete skin message:', err));
            }, 5 * 60 * 1000);

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

