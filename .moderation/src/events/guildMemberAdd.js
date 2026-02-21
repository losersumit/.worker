import { Events, EmbedBuilder } from 'discord.js';

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
                    const welcomeEmbed = new EmbedBuilder()
                        .setColor(16742912)
                        .setTitle('Welcome to National Command')
                        .setDescription(`Please read <#${process.env.INFO_CHANNEL_ID || '1448029069013815296'}> thoroughly so that you will have smooth server experience. `)
                        .setImage('https://cdn.discordapp.com/attachments/1448038019755151391/1471443121479876641/unwatermarked_Gemini_Generated_Image_i5nymki5nymki5ny.png?ex=698ef3b2&is=698da232&hm=b3e519174adf88ff3bc69ab4224f1cf835b775a8a722d47d53f4c138feb0fe1a');

                    await welcomeChannel.send({
                        content: `<@${member.id}>`,
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
