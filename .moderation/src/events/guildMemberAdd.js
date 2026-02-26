import { Events, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
    name: Events.GuildMemberAdd,
    async execute(member, client) {
        try {
            const roleId = process.env.AUTO_ROLE_ID;
            if (roleId) {
                const role = member.guild.roles.cache.get(roleId);
                if (role) await member.roles.add(role);
            }

            // Welcome Message
            const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
            if (welcomeChannelId) {
                const welcomeChannel = member.guild.channels.cache.get(welcomeChannelId);
                if (welcomeChannel && welcomeChannel.isTextBased()) {
                    const teamImg = new AttachmentBuilder(
                        path.join(__dirname, '../../../../team.png'),
                        { name: 'team.png' }
                    );
                    const welcomeEmbed = new EmbedBuilder()
                        .setColor(16742912)
                        .setTitle('Welcome to National Mobility Command')
                        .setDescription(`Please read <#${process.env.INFO_CHANNEL_ID || '1448029069013815296'}> thoroughly so that you will have a smooth server experience.`)
                        .setImage('attachment://team.png');

                    await welcomeChannel.send({
                        content: `<@${member.id}>`,
                        files: [teamImg],
                        embeds: [welcomeEmbed]
                    });
                }
            }

            const logChannelId = process.env.LOG_CHANNEL_ID;
            if (logChannelId) {
                const logChannel = member.guild.channels.cache.get(logChannelId);
                if (logChannel && logChannel.isTextBased()) {
                    await logChannel.send(`📥 **${member.user.tag}** joined the server.`);
                }
            }
        } catch (err) {
            console.error('Member join error:', err);
        }
    },
};
