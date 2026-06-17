import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, AttachmentBuilder } from 'discord.js';
import { groqChatCompletion } from '../clients/groq.js';
import config from '../config.js';
import axios from 'axios';

export default {
    data: new SlashCommandBuilder()
        .setName('sendstylingembed')
        .setDescription('Post a styled embed with a custom color analyzed from the attached image')
        .addAttachmentOption(opt =>
            opt.setName('image')
                .setDescription('The image to display in the embed')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('text')
                .setDescription('The caption / description for the styling embed')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),

    async execute(interaction) {
        // Defer reply immediately since Groq Vision analysis can take a few seconds
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // 1. Permissions Check
            const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID;
            const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID;

            const isCommander = COMMANDER_ROLE_ID && interaction.member.roles.cache.has(COMMANDER_ROLE_ID);
            const isPartner = PARTNER_ROLE_ID && interaction.member.roles.cache.has(PARTNER_ROLE_ID);
            const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

            if (!isCommander && !isPartner && !isAdmin) {
                return interaction.editReply({ content: '❌ You do not have permission to use this command. Only Commanders and Partners can use this.' });
            }

            const imageAttachment = interaction.options.getAttachment('image');
            const captionText = interaction.options.getString('text');

            if (!imageAttachment.contentType || !imageAttachment.contentType.startsWith('image/')) {
                return interaction.editReply({ content: '❌ The attached file must be an image.' });
            }

            const imageUrl = imageAttachment.url;

            // 2. Ask Groq Vision for the best matching/dominant color palette for premium HSL aesthetics
            let embedColor = 0x9B59B6; // Default to elegant purple
            let aiColorChoiceReason = 'Fallback default';

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
                console.log(`[SendStylingEmbed] Querying Groq vision model (${modelToUse}) for aesthetic color...`);

                const completion = await groqChatCompletion({
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: visionPrompt },
                                { type: "image_url", image_url: { url: imageUrl } }
                            ]
                        }
                    ],
                    model: modelToUse,
                    temperature: 0.2,
                    max_tokens: 150,
                    response_format: { type: "json_object" }
                });

                const responseText = completion?.choices?.[0]?.message?.content || '';
                console.log(`[SendStylingEmbed] AI response: ${responseText}`);
                
                const result = JSON.parse(responseText);
                if (result && result.hexColor) {
                    let colorStr = result.hexColor.trim();
                    if (colorStr.startsWith('#')) {
                        colorStr = colorStr.substring(1);
                    }
                    embedColor = parseInt(colorStr, 16);
                    aiColorChoiceReason = result.reason || 'AI selected color';
                    console.log(`[SendStylingEmbed] Success! Selected color: #${colorStr} (${aiColorChoiceReason})`);
                }
            } catch (colorErr) {
                console.error('[SendStylingEmbed] Vision check error, falling back to default:', colorErr.message);
            }

            // 3. Post to STYLING_CHANNEL_ID
            const STYLING_CHANNEL_ID = process.env.STYLING_CHANNEL_ID || '1457066114176520254';
            const stylingChannel = await interaction.client.channels.fetch(STYLING_CHANNEL_ID).catch(() => null);

            if (!stylingChannel) {
                return interaction.editReply({ content: `❌ Could not find styling channel (ID: ${STYLING_CHANNEL_ID}). Please verify bot permissions and config.` });
            }

            // Download the image buffer using axios and construct AttachmentBuilder
            console.log('[SendStylingEmbed] Downloading image for persistent embed attachment...');
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data);
            const fileName = imageAttachment.name || 'image.png';
            const file = new AttachmentBuilder(imageBuffer, { name: fileName });

            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(captionText)
                .setImage(`attachment://${fileName}`)
                .setFooter({ text: `Styling Showcase • Posted by ${interaction.member.displayName || interaction.user.username}` })
                .setTimestamp();

            await stylingChannel.send({ embeds: [embed], files: [file] });

            return interaction.editReply({ 
                content: `✅ Successfully posted to <#${STYLING_CHANNEL_ID}>!\n🎨 **Aesthetic Color**: \`#${embedColor.toString(16).toUpperCase()}\` (${aiColorChoiceReason})` 
            });

        } catch (error) {
            console.error('Error executing /sendstylingembed:', error);
            return interaction.editReply({ content: `❌ An unexpected error occurred: ${error.message}` });
        }
    }
};
