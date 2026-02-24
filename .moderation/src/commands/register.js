
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, WebhookClient } from 'discord.js';
import { supabase } from '../clients/supabase.js'; // Updated import
import dotenv from 'dotenv';

dotenv.config();

export default {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register a player with a number')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The player to register')
                .setRequired(true)
        )

        .addStringOption(option =>
            option.setName('number')
                .setDescription('The 3-digit registration number')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(3)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. Check Roles
            const allowedRolesEnv = process.env.REGISTER_ALLOWED_ROLES || '';
            const allowedRoles = allowedRolesEnv.split(',').map(r => r.trim()).filter(Boolean);

            const hasPermission = allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId)) ||
                interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasPermission) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
            }

            const targetUser = interaction.options.getUser('user');
            const registrationNumber = interaction.options.getString('number');

            // Validate number format (3 digits)
            if (!/^\d{3}$/.test(registrationNumber)) {
                return interaction.editReply({ content: '❌ Registration number must be exactly 3 digits (e.g., 007).' });
            }

            // 2. Fetch Guild Info
            const guildId = interaction.guildId;
            let guildTag = null;

            if (guildId) {
                const { data: guildData, error: guildError } = await supabase
                    .from('approved_guilds')
                    .select('guild_tag')
                    .eq('guild_id', guildId)
                    .single();

                if (guildError && guildError.code !== 'PGRST116') {
                    console.error('Error fetching guild tag:', guildError);
                    // Proceeding without tag might be okay, or we should block. 
                    // Requirements say "you will find corresponding guild tag", implying existence.
                    // But if not found, we probably just leave it null or fail? 
                    // Let's warn but proceed.
                } else if (guildData) {
                    guildTag = guildData.guild_tag;
                }
            }

            // 3. Update/Insert Player (Players table ALWAYS updates/replaces)
            const { data: playerData, error: playerError } = await supabase
                .from('players')
                .upsert({
                    discord_id: targetUser.id,
                    username: targetUser.username,
                    registration_number: registrationNumber,
                    guild_id: guildId ? guildId.toString() : null,
                    guild_tag: guildTag,
                    // joined_at: new Date().toISOString() // upsert might overwrite joined_at if we include it. 
                    // Let's only set joined_at on insert if possible, OR just update it. 
                    // Postgres 'upsert' usually replaces the whole row or updates specified columns.
                    // If we want to keep original joined_at, we should select first?
                    // User said "automatically add ... updating their guild id ... also add the guild tag ... username and registration number"
                    // And "Players has been updated". 
                    // Let's include joined_at only if it's a fresh insert, but supabase .upsert is all-or-nothing usually unless we use onConflict.
                    // Simplest is to just upsert the core fields. "joined_at" is default now() in DB mostly, but let's see schema. 
                    // Schema: joined_at timestamp without time zone default now().
                    // We can omit joined_at and let DB handle it for new rows, but for updates it won't change.
                    // Wait, if we upsert, we might want to preserve keys. 
                    // Supabase upsert updates match columns.
                }, { onConflict: 'discord_id' })
                .select()
                .single();

            if (playerError) {
                console.error('Error upserting player:', playerError);
                return interaction.editReply({ content: `❌ Failed to register player in 'players' table: ${playerError.message}` });
            }

            const playerId = playerData.id; // UUID

            // 4. Initialize Player Stats (Insert ONLY if not exists)
            // We check existence first
            const { data: existingStats, error: statsFetchError } = await supabase
                .from('player_stats')
                .select('player_id')
                .eq('player_id', playerId)
                .single();

            let statsMsg = "Stats already initialized.";
            if (!existingStats) {
                const { error: statsInsertError } = await supabase
                    .from('player_stats')
                    .insert({
                        player_id: playerId,
                        total_distance_km: 0,
                        total_time_minutes: 0,
                        best_avg_speed_kmph: 0,
                        clean_deliveries: 0,
                        current_level: 1,
                        total_damage_penalty: 0,
                        total_time_penalty: 0,
                        total_score: 0,
                        total_stars: 0,
                        last_level: 0,
                        last_xp: 0,
                        total_income: 0
                    });

                if (statsInsertError) {
                    console.error('Error inserting stats:', statsInsertError);
                    statsMsg = "❌ Failed to init stats.";
                } else {
                    statsMsg = "✅ Stats initialized.";
                }
            }

            // 5. Initialize Player Economy (Insert ONLY if not exists)
            const { data: existingEconomy, error: ecoFetchError } = await supabase
                .from('player_economy_data')
                .select('player_id')
                .eq('player_id', playerId)
                .single();

            let ecoMsg = "Economy already initialized.";
            if (!existingEconomy) {
                const { error: ecoInsertError } = await supabase
                    .from('player_economy_data')
                    .insert({
                        player_id: playerId,
                        total_tax_paid: 0,
                        total_gambling_won: 0,
                        total_gambling_lost: 0,
                        total_donated: 0,
                        total_transferred: 0,
                        username: targetUser.username
                    });

                if (ecoInsertError) {
                    console.error('Error inserting economy:', ecoInsertError);
                    ecoMsg = "❌ Failed to init economy.";
                } else {
                    ecoMsg = "✅ Economy initialized.";
                }
            }

            // 6. Update Registry Message (supports both embeds and component-based layouts)
            let embedMsg = "";
            try {
                const webhookUrl = process.env.REGISTER_WEBHOOK_URL;
                const messageId = process.env.REGISTER_EMBED_MESSAGE_ID;
                const channelId = process.env.REGISTER_EMBED_CHANNEL_ID;

                if (webhookUrl && messageId) {
                    const webhook = new WebhookClient({ url: webhookUrl });
                    let embed;
                    let message;

                    if (channelId) {
                        try {
                            const channel = await interaction.guild.channels.fetch(channelId);
                            message = await channel.messages.fetch(messageId);
                            embed = message.embeds[0];
                        } catch (e) {
                            console.error("Could not fetch original message via Bot for Embed Update:", e);
                        }
                    }

                    if (embed) {
                        let lines = embed.description ? embed.description.split('\n') : [];
                        let entryFound = false;
                        const newEntry = `<@${targetUser.id}> — \`${registrationNumber}\``;

                        const updatedLines = lines.map(line => {
                            if (line.includes(`<@${targetUser.id}>`)) {
                                entryFound = true;
                                return newEntry;
                            }
                            return line;
                        });

                        if (!entryFound) {
                            updatedLines.push(newEntry);
                        }

                        const newEmbed = EmbedBuilder.from(embed).setDescription(updatedLines.join('\n'));
                        await webhook.editMessage(messageId, { embeds: [newEmbed] });
                        embedMsg = "✅ Registry Embed updated.";
                    } else if (message?.components?.length) {
                        const components = message.components.map(component =>
                            typeof component.toJSON === 'function' ? component.toJSON() : component
                        );

                        const newEntry = `<@${targetUser.id}> — \`${registrationNumber}\``;

                        const hasExistingEntry = components.some(component =>
                            component?.type === 17 &&
                            Array.isArray(component.components) &&
                            component.components.some(inner =>
                                inner?.type === 10 &&
                                typeof inner.content === 'string' &&
                                inner.content.includes(`<@${targetUser.id}>`)
                            )
                        );

                        let entryUpdated = false;
                        let appendTargetSet = false;

                        const updatedComponents = components.map(component => {
                            if (component?.type !== 17 || !Array.isArray(component.components)) {
                                return component;
                            }

                            const updatedInner = component.components.map(inner => {
                                if (inner?.type !== 10 || typeof inner.content !== 'string') {
                                    return inner;
                                }

                                if (hasExistingEntry && inner.content.includes(`<@${targetUser.id}>`)) {
                                    entryUpdated = true;
                                    const lines = inner.content.split('\n').map(line =>
                                        line.includes(`<@${targetUser.id}>`) ? newEntry : line
                                    );
                                    return { ...inner, content: lines.join('\n') };
                                }

                                if (!hasExistingEntry && !appendTargetSet && !inner.content.trim().startsWith('#')) {
                                    appendTargetSet = true;
                                    return { ...inner, content: `${inner.content}\n${newEntry}` };
                                }

                                return inner;
                            });

                            return { ...component, components: updatedInner };
                        });

                        // If neither an in-place update nor an append happened, push a new block
                        if (!entryUpdated && !appendTargetSet) {
                            updatedComponents.push({
                                type: 17,
                                components: [
                                    {
                                        type: 10,
                                        content: newEntry
                                    }
                                ],
                                accent_color: 196713
                            });
                        }

                        await webhook.editMessage(messageId, { components: updatedComponents });
                        embedMsg = "✅ Registry components updated.";
                    } else {
                        embedMsg = "⚠️ Registry Embed not found (check config).";
                    }
                } // end if (webhookUrl && messageId)
            } catch (err) {
                console.error("Embed update error:", err);
                embedMsg = "⚠️ Embed update failed.";
            }

            // 7. Assign Enlisted Driver Role
            let roleMsg = "";
            try {
                const ROLE_ID = '1463184412937289973';
                const member = await interaction.guild.members.fetch(targetUser.id);
                if (member) {
                    await member.roles.add(ROLE_ID);
                    roleMsg = "✅ Role assigned.";
                } else {
                    roleMsg = "⚠️ Member not found in guild.";
                }
            } catch (roleErr) {
                console.error("Role assignment error:", roleErr);
                roleMsg = "❌ Failed to assign role (Check Permissions).";
            }

            // Final Reply
            const finalContent = `✅ **Registration Complete** for ${targetUser}\n` +
                `Guild: ${guildTag || 'None'} (${guildId})\n` +
                `Number: ${registrationNumber}\n` +
                `Tables:\n` +
                `> Players: ✅ Updated\n` +
                `> Stats: ${statsMsg}\n` +
                `> Economy: ${ecoMsg}\n` +
                `> Embed: ${embedMsg}\n` +
                `> Role: ${roleMsg}`;

            return interaction.editReply({ content: finalContent });

        } catch (error) {
            console.error('Error in /register:', error);
            return interaction.editReply({ content: `❌ An unexpected error occurred: ${error.message}` });
        }
    }
};
