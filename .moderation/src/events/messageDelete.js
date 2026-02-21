import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';

export default {
    name: Events.MessageDelete,
    async execute(message, client) {
        console.log(`[DeleteLog] Message deleted event fired. ID: ${message.id}`);

        if (message.partial) {
            console.log(`[DeleteLog] Message is partial (uncached). Attempting to fetch if possible (usually not logic for delete).`);
        }

        if (message.author?.bot) {
            console.log('[DeleteLog] Ignoring bot message deletion.');
            return;
        }

        const logChannelId = process.env.LOG_CHANNEL_ID;
        if (!logChannelId) {
            console.log('[DeleteLog] No LOG_CHANNEL_ID configured.');
            return;
        }

        const logChannel = message.guild.channels.cache.get(logChannelId);
        if (!logChannel || !logChannel.isTextBased()) {
            console.log(`[DeleteLog] Log channel ${logChannelId} not found or not text-based.`);
            return;
        }

        // Retrieve Audit Logs to find who deleted it
        let executor = null;
        try {
            const fetchedLogs = await message.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MessageDelete,
            });
            const deletionLog = fetchedLogs.entries.first();

            console.log('[DeleteLog] Audit logs fetched.');
            if (deletionLog) {
                console.log(`[DeleteLog] Found audit entry. Time diff: ${Date.now() - deletionLog.createdTimestamp}ms`);
                // If < 5000ms, assume correlation
                if ((Date.now() - deletionLog.createdTimestamp) < 5000) {
                    // If target matches author
                    if (deletionLog.target.id === message.author?.id) {
                        executor = deletionLog.executor;
                        console.log(`[DeleteLog] Executor identified: ${executor.tag}`);
                    } else {
                        console.log(`[DeleteLog] Audit log target ${deletionLog.target.id} != Message author ${message.author?.id}`);
                    }
                } else {
                    console.log('[DeleteLog] Audit log too old.');
                }
            } else {
                console.log('[DeleteLog] No audit log deletion entry found.');
            }
        } catch (e) {
            console.error("[DeleteLog] Error fetching audit logs:", e);
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF0000) // Red
            .setTitle('🗑️ Message Deleted')
            .setTimestamp();

        if (message.author) {
            embed.setThumbnail(message.author.displayAvatarURL());
            embed.addFields(
                { name: '👤 Author', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                { name: '🗑️ Deleted By', value: executor ? `${executor.tag} (<@${executor.id}>)` : 'Self (or Unknown)', inline: true },
                { name: '📍 Channel', value: `<#${message.channel.id}>`, inline: true }
            );
        } else {
            embed.setDescription('Message was uncached (partial), so content/author is unknown.');
            embed.addFields({ name: '📍 Channel', value: `<#${message.channel.id}>`, inline: true });
        }

        if (message.content) {
            // Truncate if too long (max 1024)
            const content = message.content.length > 1000 ? message.content.substring(0, 1000) + '...' : message.content;
            embed.addFields({ name: '📄 Content', value: content });
        }

        if (message.attachments && message.attachments.size > 0) {
            const attachmentInfo = message.attachments.map(a => `[${a.name}](${a.url})`).join('\n');
            embed.addFields({ name: '📎 Attachments', value: attachmentInfo });
            // Try to set image if it's an image
            const firstImage = message.attachments.find(a => a.contentType?.startsWith('image/'));
            if (firstImage) {
                embed.setImage(firstImage.url);
            }
        }

        logChannel.send({ embeds: [embed] }).then(() => console.log('[DeleteLog] Embed sent.')).catch(err => console.error("Failed to log deletion:", err));
    },
};
