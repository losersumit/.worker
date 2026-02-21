import { Events } from 'discord.js';

export default {
    name: Events.GuildMemberRemove,
    async execute(member, client) {
        try {
            const logChannelId = process.env.LOG_CHANNEL_ID;
            if (logChannelId) {
                const logChannel = member.guild.channels.cache.get(logChannelId);
                if (logChannel && logChannel.isTextBased()) {
                    await logChannel.send(`📤 **${member.user.tag}** left the server.`);
                }
            }
        } catch (err) {
            console.error('Member leave error:', err);
        }
    },
};
