import { Events } from 'discord.js';
import config from "../config/index.js";

export default {
    name: Events.GuildMemberRemove,
    async execute(member, client) {
        try {
            const logChannelId = config.channels.LOG;
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
