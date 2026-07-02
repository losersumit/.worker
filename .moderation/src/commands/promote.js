import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { supabase } from '../clients/supabase.js';

export default {
    data: new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a user to their next rank (O -> FO, or FO -> SMO)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The player to promote')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Support Ephemeral deferred replies
        await interaction.deferReply({ flags: MessageFlags?.Ephemeral ? MessageFlags.Ephemeral : undefined, ephemeral: true });

        try {
            // Check roles/permissions
            const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID;
            const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID;

            const isCommander = COMMANDER_ROLE_ID && interaction.member.roles.cache.has(COMMANDER_ROLE_ID);
            const isPartner = PARTNER_ROLE_ID && interaction.member.roles.cache.has(PARTNER_ROLE_ID);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isCommander && !isPartner && !isAdmin) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command. Only Commanders and Partners can use this.' });
            }

            const targetUser = interaction.options.getUser('user');
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            if (!member) {
                return interaction.editReply({ content: '❌ That user is not in this server.' });
            }

            const TRAINING_ROLE_ID = process.env.TRAINEE_ROLE_ID || '1475196328303792138';
            const O_ROLE_ID = process.env.O_ROLE_ID || '1475314870802055421';
            const FO_ROLE_ID = process.env.FO_ROLE_ID || '1475314865878077603';
            const SMO_ROLE_ID = process.env.SMO_ROLE_ID || '1475314856184778835';

            // Ensure target user has the Trainee role before promoting
            if (!member.roles.cache.has(TRAINING_ROLE_ID)) {
                return interaction.editReply({ content: `❌ **${targetUser.username}** does not have the Trainee role. Promotion rejected.` });
            }

            let promotedFrom = '';
            let promotedTo = '';
            let oldRole = '';
            let newRole = '';

            // Check current rank role
            if (member.roles.cache.has(O_ROLE_ID)) {
                promotedFrom = 'Operator [O]';
                promotedTo = 'Field Operator [FO]';
                oldRole = O_ROLE_ID;
                newRole = FO_ROLE_ID;
            } else if (member.roles.cache.has(FO_ROLE_ID)) {
                promotedFrom = 'Field Operator [FO]';
                promotedTo = 'Senior Mobility Operator [SMO]';
                oldRole = FO_ROLE_ID;
                newRole = SMO_ROLE_ID;
            } else {
                return interaction.editReply({ content: '❌ User does not have Operator [O] or Field Operator [FO] role.' });
            }

            // Remove trainee role if they have it
            let removedTrainee = false;
            if (member.roles.cache.has(TRAINING_ROLE_ID)) {
                await member.roles.remove(TRAINING_ROLE_ID);
                removedTrainee = true;
            }

            // Perform role transition
            await member.roles.remove(oldRole);
            await member.roles.add(newRole);

            // Update nickname: replace [O] with [FO], or [FO] with [SMO]
            const currentNickname = member.nickname || targetUser.displayName || targetUser.username;
            let newNickname = currentNickname;

            if (oldRole === O_ROLE_ID) {
                if (newNickname.includes('[O]')) {
                    newNickname = newNickname.replace('[O]', '[FO]');
                } else if (!newNickname.startsWith('[FO]')) {
                    newNickname = `[FO] ${newNickname}`;
                }
            } else if (oldRole === FO_ROLE_ID) {
                if (newNickname.includes('[FO]')) {
                    newNickname = newNickname.replace('[FO]', '[SMO]');
                } else if (!newNickname.startsWith('[SMO]')) {
                    newNickname = `[SMO] ${newNickname}`;
                }
            }

            newNickname = newNickname.substring(0, 32);

            let nickMsg = '';
            try {
                if (currentNickname !== newNickname) {
                    await member.setNickname(newNickname);
                    nickMsg = `Nickname updated to: \`${newNickname}\``;
                } else {
                    nickMsg = 'Nickname already formatted correctly.';
                }
            } catch (nickErr) {
                console.error('[Promote] Failed to update nickname:', nickErr.message);
                nickMsg = '⚠️ Failed to update nickname (Check bot permissions / role hierarchy).';
            }

            // Fetch stats for Milestone notification
            let jobsDone = 0;
            let cleanDeliveries = 0;
            try {
                const { data: playerData } = await supabase
                    .from('players')
                    .select('id')
                    .eq('discord_id', targetUser.id)
                    .maybeSingle();

                if (playerData) {
                    const { data: stats } = await supabase
                        .from('player_stats')
                        .select('runs, clean_deliveries')
                        .eq('player_id', playerData.id)
                        .maybeSingle();
                    if (stats) {
                        jobsDone = stats.runs || 0;
                        cleanDeliveries = stats.clean_deliveries || 0;
                    }
                }
            } catch (dbErr) {
                console.error('[Promote] Database fetch error:', dbErr);
            }

            // Send Milestone embed
            const milestoneChannelId = process.env.MILESTONES_CHANNEL_ID;
            if (milestoneChannelId) {
                try {
                    const mChannel = await interaction.client.channels.fetch(milestoneChannelId).catch(() => null);
                    if (mChannel) {
                        const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
                        const milestoneEmbed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('🎉 Rank Promotion')
                            .setDescription(`**${targetUser.username}** has been promoted to **${promotedTo}**!`)
                            .setThumbnail(avatarUrl)
                            .addFields(
                                { name: '👤 Driver', value: `<@${targetUser.id}>`, inline: true },
                                { name: 'Promotion Path', value: `${promotedFrom} ➡️ ${promotedTo}`, inline: true }
                            )
                            .setFooter({ text: 'National Mobility Command • Promotions' })
                            .setTimestamp();

                        if (oldRole === O_ROLE_ID) {
                            milestoneEmbed.addFields({ name: 'Jobs Done', value: `${jobsDone}`, inline: true });
                        } else if (oldRole === FO_ROLE_ID) {
                            milestoneEmbed.addFields({ name: 'Clean Deliveries', value: `${cleanDeliveries}`, inline: true });
                        }

                        await mChannel.send({ embeds: [milestoneEmbed] });
                    }
                } catch (sendErr) {
                    console.error('[Promote] Failed to send milestone embed:', sendErr);
                }
            }

            // Success response
            const embed = new EmbedBuilder()
                .setTitle('🎉 Promotion Successful!')
                .setColor('#00ff00')
                .setDescription(`Successfully promoted **${targetUser.username}**!`)
                .addFields(
                    { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                    { name: 'Promotion Path', value: `${promotedFrom} ➡️ ${promotedTo}`, inline: true },
                    { name: 'Trainee Role Removed', value: removedTrainee ? '✅ Yes' : 'No Trainee role detected', inline: true },
                    { name: 'Status', value: nickMsg }
                )
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in /promote:', error);
            return interaction.editReply({ content: `❌ An unexpected error occurred: ${error.message}` });
        }
    }
};
