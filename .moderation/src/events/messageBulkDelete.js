import { Events, EmbedBuilder } from 'discord.js';

export default {
    name: Events.MessageBulkDelete,
    async execute(messages, client) {
        console.log(`[DeleteLog] Bulk delete event. Count: ${messages.size}`);
        const logChannelId = process.env.LOG_CHANNEL_ID;
        if (!logChannelId) return;

        const loggingChannel = messages.first().guild.channels.cache.get(logChannelId);
        if (!loggingChannel || !loggingChannel.isTextBased()) return;

        const count = messages.size;
        const channel = messages.first().channel;

        const embed = new EmbedBuilder()
            .setColor(0xFFA500) // Orange
            .setTitle('🧹 Bulk Delete (Purge)')
            .setDescription(`**${count}** messages were purged in <#${channel.id}>.`)
            .setFooter({ text: 'Details of individual messages are not logged for bulk actions to prevent spam.' })
            .setTimestamp();

        loggingChannel.send({ embeds: [embed] }).catch(console.error);
    },
};
