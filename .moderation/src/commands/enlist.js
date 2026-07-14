
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, WebhookClient } from 'discord.js';
import { supabase } from '../clients/supabase.js'; // Updated import
import { rebuildPersonnelEmbeds } from '../jobs/inactivityScanner.js';
import dotenv from 'dotenv';

dotenv.config();

export default {
    data: new SlashCommandBuilder()
        .setName('enlist')
        .setDescription('Enlist a player with a registration number (defaults to Operator [O])')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The player to enlist')
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
            const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID;
            const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID;

            const isCommander = COMMANDER_ROLE_ID && interaction.member.roles.cache.has(COMMANDER_ROLE_ID);
            const isPartner = PARTNER_ROLE_ID && interaction.member.roles.cache.has(PARTNER_ROLE_ID);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isCommander && !isPartner && !isAdmin) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command. Only Commanders and Partners can use this.' });
            }

            const targetUser = interaction.options.getUser('user');
            const registrationNumber = interaction.options.getString('number');

            // Validate number format (3 digits)
            if (!/^\d{3}$/.test(registrationNumber)) {
                return interaction.editReply({ content: '❌ Registration number must be exactly 3 digits (e.g., 007).' });
            }

            // Ensure target user has the Trainee role before enlisting
            const TRAINEE_ROLE_ID = process.env.TRAINEE_ROLE_ID || '1475196328303792138';
            const targetMemberCheck = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMemberCheck) {
                return interaction.editReply({ content: '❌ That user is not in this server.' });
            }
            if (!targetMemberCheck.roles.cache.has(TRAINEE_ROLE_ID)) {
                return interaction.editReply({ content: `❌ **${targetUser.username}** does not have the Trainee role. Enlistment rejected.` });
            }

            // Check if player has at least 2000 km in player_stats
            const { data: existingPlayer, error: playerFetchError } = await supabase
                .from('players')
                .select('id')
                .eq('discord_id', targetUser.id)
                .maybeSingle();

            let totalKm = 0;
            if (existingPlayer) {
                const { data: statsData, error: statsFetchError } = await supabase
                    .from('player_stats')
                    .select('total_distance_km')
                    .eq('player_id', existingPlayer.id)
                    .maybeSingle();
                if (statsData) {
                    totalKm = statsData.total_distance_km || 0;
                }
            }

            if (totalKm < 2000) {
                return interaction.editReply({
                    content: `❌ **${targetUser.username}** only has **${totalKm.toLocaleString()} km** (minimum 2,000 km required in player_stats). Enlistment rejected.`
                });
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
                const webhookUrl = process.env.OFFICERS_CHANNEL_WEBHOOK;
                const messageId = process.env.AP_EMBED_MESSAGE_ID;
                const channelId = process.env.ENLISTED_CHANNEL_ID;

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

                        // Check if user already has an entry in any text block
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

                            // Update existing entry (line-by-line replace inside the text block)
                            if (hasExistingEntry) {
                                const updatedInner = component.components.map(inner => {
                                    if (inner?.type !== 10 || typeof inner.content !== 'string') return inner;
                                    if (!inner.content.includes(`<@${targetUser.id}>`)) return inner;
                                    entryUpdated = true;
                                    const lines = inner.content.split('\n').map(line =>
                                        line.includes(`<@${targetUser.id}>`) ? newEntry : line
                                    );
                                    return { ...inner, content: lines.join('\n') };
                                });
                                return { ...component, components: updatedInner };
                            }

                            // Append to the entries container (identified by accent_color)
                            if (!appendTargetSet && component.accent_color != null) {
                                appendTargetSet = true;
                                const updatedInner = component.components.map((inner, idx) => {
                                    if (idx !== 0 || inner?.type !== 10 || typeof inner.content !== 'string') return inner;
                                    return { ...inner, content: `${inner.content}\n${newEntry}` };
                                });
                                return { ...component, components: updatedInner };
                            }

                            return component;
                        });

                        // Fallback: no accent_color container found — push a new one
                        if (!entryUpdated && !appendTargetSet) {
                            updatedComponents.push({
                                type: 17,
                                components: [{ type: 10, content: newEntry }],
                                accent_color: 196713
                            });
                        }

                        // IS_COMPONENTS_V2 flag (32768) is required when editing V2 messages
                        await webhook.editMessage(messageId, {
                            components: updatedComponents,
                            flags: 32768
                        });
                        embedMsg = "✅ Registry components updated.";
                    } else {
                        embedMsg = "⚠️ Registry Embed not found (check config).";
                    }
                } // end if (webhookUrl && messageId)
            } catch (err) {
                console.error("Embed update error:", err);
                embedMsg = "⚠️ Embed update failed.";
            }

            // 7. Assign Enlisted Driver Role, optionally an Officer Role, and remove Unregistered / Retired Roles
            let roleMsg = "";
            try {
                const ENLISTED_ROLE_ID = process.env.AP_ROLE_ID || '1463184412937289973';
                const ENLISTED_TAG_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1482386008376086598';
                const UNREGISTERED_ROLE_ID = process.env.TRAINEE_ROLE_ID || '1475196328303792138';
                const RTD_ROLE_ID = process.env.RTD_ROLE_ID || '1499413282279129139';
                const officerRoleId = process.env.O_ROLE_ID || '1475314870802055421';
                const member = await interaction.guild.members.fetch(targetUser.id);
                if (member) {
                    await member.roles.add(ENLISTED_ROLE_ID);
                    await member.roles.add(ENLISTED_TAG_ROLE_ID);
                    roleMsg = "✅ Enlisted roles assigned.";

                    try {
                        const photoUrl = targetUser.displayAvatarURL({ size: 512, extension: 'png' });
                        await supabase.from('enlisted_drivers').upsert({
                            discord_id: targetUser.id,
                            display_name: targetUser.username,
                            unit_number: registrationNumber,
                            status: 'AP',
                            photo_url: photoUrl
                        }, { onConflict: 'discord_id' });
                    } catch (dbErr) {
                        console.error("Failed to insert into enlisted_drivers:", dbErr);
                    }

                    if (member.roles.cache.has(UNREGISTERED_ROLE_ID)) {
                        await member.roles.remove(UNREGISTERED_ROLE_ID);
                        roleMsg += " (Removed Unregistered Role).";
                    }

                    if (member.roles.cache.has(RTD_ROLE_ID)) {
                        await member.roles.remove(RTD_ROLE_ID);
                        roleMsg += " (Removed Retired Role).";
                    }

                    if (officerRoleId) {
                        try {
                            await member.roles.add(officerRoleId);
                            
                            const initialsMap = {
                                [process.env.SMO_ROLE_ID || '1475314856184778835']: '[SMO]',
                                [process.env.FO_ROLE_ID || '1475314865878077603']: '[FO]',
                                [process.env.O_ROLE_ID || '1475314870802055421']: '[O]'
                            };
                            const initial = initialsMap[officerRoleId] || '[O]';
                            
                            // Nickname update: Strip existing prefixes to avoid duplicates/residues (like [Rtd.], [RP], etc.)
                            const currentName = member.nickname || targetUser.displayName || targetUser.username;
                            const cleanedName = currentName
                                .replace(/\[RP\]\s*/gi, '')
                                .replace(/\[Rtd\.\]\s*/gi, '')
                                .replace(/\[SMO\]\s*/gi, '')
                                .replace(/\[FO\]\s*/gi, '')
                                .replace(/\[O\]\s*/gi, '')
                                .trim();
                            const newNick = `${initial} ${cleanedName}`.substring(0, 32);
                            if (currentName !== newNick) {
                                await member.setNickname(newNick);
                            }
                            
                            roleMsg = `✅ Enlisted & ${initial} roles assigned, nickname updated.`;
                        } catch (officerErr) {
                            console.error("Officer role/nickname assignment error:", officerErr);
                            roleMsg = "✅ Enlisted assigned. ⚠️ Failed to assign officer role or update nickname.";
                        }
                    }

                    // Trigger a full, clean rebuild of AP, RP, and RTD embeds to seamlessly transfer the user
                    try {
                        await rebuildPersonnelEmbeds(interaction.client, supabase);
                        embedMsg += " & Fully Rebuilt.";
                    } catch (rebuildErr) {
                        console.error("Failed to rebuild embeds in /enlist:", rebuildErr);
                        embedMsg += " (⚠️ Rebuild failed, but registry updated).";
                    }

                    // Send Milestone embed
                    const milestoneChannelId = process.env.MILESTONES_CHANNEL_ID;
                    if (milestoneChannelId) {
                        try {
                            const mChannel = await interaction.client.channels.fetch(milestoneChannelId).catch(() => null);
                            if (mChannel) {
                                const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
                                const { data: stats } = await supabase
                                    .from('player_stats')
                                    .select('total_distance_km')
                                    .eq('player_id', playerId)
                                    .maybeSingle();
                                const kms = stats ? Number(stats.total_distance_km || 0) : 0;

                                const embed = new EmbedBuilder()
                                    .setColor(0x00ff00)
                                    .setTitle('🎖️ Driver Enlisted')
                                    .setDescription(`**${targetUser.username}** has been enlisted in NMC!`)
                                    .setThumbnail(avatarUrl)
                                    .addFields(
                                        { name: '👤 Driver', value: `<@${targetUser.id}>`, inline: true },
                                        { name: 'Assigned UNIT Number', value: `${registrationNumber}`, inline: true },
                                        { name: 'Current KMs', value: `${kms.toLocaleString()} km`, inline: true }
                                    )
                                    .setFooter({ text: 'National Mobility Command • Enlistment' })
                                    .setTimestamp();
                                await mChannel.send({ embeds: [embed] });
                            }
                        } catch (sendErr) {
                            console.error('[Enlist] Failed to send milestone embed:', sendErr);
                        }
                    }
                } else {
                    roleMsg = "⚠️ Member not found in guild.";
                }
            } catch (roleErr) {
                console.error("Role assignment error:", roleErr);
                roleMsg = "❌ Failed to assign role(s) (Check Permissions).";
            }

            // Final Reply
            const finalContent = `✅ **Enlistment Complete** for ${targetUser}\n` +
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
