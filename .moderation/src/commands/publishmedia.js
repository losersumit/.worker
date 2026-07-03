import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, AttachmentBuilder } from 'discord.js';
import { groqChatCompletion } from '../clients/groq.js';
import { supabase } from '../clients/supabase.js';
import { publishToInstagram } from '../clients/socials.js';
import config from '../config.js';
import axios from 'axios';

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

export default {
    data: new SlashCommandBuilder()
        .setName('publishmedia')
        .setDescription('Upload media to styling channel, add to website gallery, and publish to Instagram')
        .addAttachmentOption(opt =>
            opt.setName('media')
                .setDescription('The image or video file to publish')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('description')
                .setDescription('Shared caption / description for styling embed, Supabase, and Instagram')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Defer reply since fetching, vision analysis, and social publishing can take several seconds
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // 1. Role Check (Admins, Commanders, Partners)
            const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID;
            const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID;

            const isCommander = COMMANDER_ROLE_ID && interaction.member.roles.cache.has(COMMANDER_ROLE_ID);
            const isPartner = PARTNER_ROLE_ID && interaction.member.roles.cache.has(PARTNER_ROLE_ID);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isCommander && !isPartner && !isAdmin) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command. Only Commanders and Partners can use this.' });
            }

            const mediaAttachment = interaction.options.getAttachment('media');
            const description = interaction.options.getString('description');

            const filename = (mediaAttachment.name || '').toLowerCase();
            const isVideo = VIDEO_EXTS.some(ext => filename.endsWith(ext)) || (mediaAttachment.contentType && mediaAttachment.contentType.startsWith('video/'));
            const mediaType = isVideo ? 'video' : 'image';

            // 2. Groq Vision for aesthetic color (Only for images)
            let embedColor = 0x9B59B6; // Elegant default purple
            let aiColorChoiceReason = 'Default theme color';

            if (mediaType === 'image') {
                try {
                    const visionPrompt = `
            Analyze this image and determine the dominant, most visually appealing accent color that matches its aesthetic, tone, and vibe.
            This color will be used as the border/embed color in a Discord channel to present this image beautifully.
            Provide a single hex color code (including the '#' symbol).

            Respond in JSON format only:
            {
              "hexColor": "#HEXCODE",
              "reason": "brief explanation of color choice"
            }
          `;

                    const modelToUse = config.ai.visionModel || config.ai.fallbackVisionModel || "meta-llama/llama-4-scout-17b-16e-instruct";
                    console.log(`[PublishMedia] Querying Groq vision model (${modelToUse}) for aesthetic color...`);

                    const completion = await groqChatCompletion({
                        messages: [
                            {
                                role: "user",
                                content: [
                                    { type: "text", text: visionPrompt },
                                    { type: "image_url", image_url: { url: mediaAttachment.url } }
                                ]
                            }
                        ],
                        model: modelToUse,
                        temperature: 0.2,
                        max_tokens: 150,
                        response_format: { type: "json_object" }
                    });

                    const responseText = completion?.choices?.[0]?.message?.content || '';
                    const result = JSON.parse(responseText);
                    if (result && result.hexColor) {
                        let colorStr = result.hexColor.trim();
                        if (colorStr.startsWith('#')) {
                            colorStr = colorStr.substring(1);
                        }
                        embedColor = parseInt(colorStr, 16);
                        aiColorChoiceReason = result.reason || 'AI selected color';
                        console.log(`[PublishMedia] Success! Selected color: #${colorStr} (${aiColorChoiceReason})`);
                    }
                } catch (colorErr) {
                    console.error('[PublishMedia] Vision check error, falling back to default:', colorErr.message);
                }
            }

            // 3. Post styling embed to STYLING_CHANNEL_ID
            const STYLING_CHANNEL_ID = process.env.STYLING_CHANNEL_ID || '1457066114176520254';
            const stylingChannel = await interaction.client.channels.fetch(STYLING_CHANNEL_ID).catch(() => null);

            if (!stylingChannel) {
                return interaction.editReply({ content: `❌ Could not find styling channel (ID: ${STYLING_CHANNEL_ID}).` });
            }

            console.log('[PublishMedia] Downloading media for persistent styling embed attachment...');
            const mediaResponse = await axios.get(mediaAttachment.url, { responseType: 'arraybuffer' });
            const mediaBuffer = Buffer.from(mediaResponse.data);
            const file = new AttachmentBuilder(mediaBuffer, { name: filename });

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(description)
                .setFooter({ text: `Styling Showcase • Posted by ${interaction.member.displayName || interaction.user.username}` })
                .setTimestamp();

            if (mediaType === 'image') {
                embed.setImage(`attachment://${filename}`);
            }



            const sentMessage = await stylingChannel.send({ embeds: [embed], files: [file] });
            const sentAttachment = sentMessage.attachments.first();
            const finalMediaUrl = sentAttachment ? sentAttachment.url : mediaAttachment.url;

            // 4. Save to Supabase (NMC website media gallery)
            console.log('[PublishMedia] Saving entry to Supabase...');
            const finalMessageLink = `https://discord.com/channels/${interaction.guildId}/${STYLING_CHANNEL_ID}/${sentMessage.id}`;

            const { error: dbError } = await supabase.from('media_gallery').insert([{
                channel_id: STYLING_CHANNEL_ID,
                message_id: sentMessage.id,
                message_link: finalMessageLink,
                media_url: finalMediaUrl,
                media_type: mediaType,
                description: description,
                added_by: interaction.user.tag,
            }]);

            let supabaseStatus = '✅ Saved';
            if (dbError) {
                console.error('[PublishMedia] Supabase insertion error:', dbError);
                supabaseStatus = `❌ Failed: ${dbError.message}`;
            }

            // 5. Post to Instagram
            console.log('[PublishMedia] Publishing to Instagram...');
            let instagramStatus = 'Pending';
            try {
                const igPostId = await publishToInstagram({
                    mediaUrl: finalMediaUrl,
                    mediaType: mediaType,
                    caption: description
                });
                instagramStatus = `✅ Posted (ID: ${igPostId})`;
            } catch (igErr) {
                console.error('[PublishMedia] Instagram publish error:', igErr);
                instagramStatus = `❌ Failed: ${igErr.message}`;
            }

            // Status message
            return interaction.editReply({
                content: `🎨 **Media Publishing Status**:\n` +
                         `• **Styling Channel**: ✅ Posted to <#${STYLING_CHANNEL_ID}>\n` +
                         `• **Supabase Website DB**: ${supabaseStatus}\n` +
                         `• **Instagram**: ${instagramStatus}\n` +
                         `• **Facebook**: 🔄 Cross-posted automatically via Instagram\n` +
                         `• **TikTok**: ⏳ Pending (Scheduled to scale later)`
            });

        } catch (error) {
            console.error('Error executing /publishmedia:', error);
            return interaction.editReply({ content: `❌ An unexpected error occurred: ${error.message}` });
        }
    }
};
