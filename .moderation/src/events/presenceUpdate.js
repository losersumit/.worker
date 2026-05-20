import { Events, EmbedBuilder } from 'discord.js';

const UVS_BOT_ID = '1464033910726988011';
const STATUS_CHANNEL_ID = '1501202665319956562';
let statusMessageId = null; 

export default {
    name: Events.PresenceUpdate,
    async execute(oldPresence, newPresence, client) {
        if (!newPresence || !newPresence.user) return;
        
        // We only care about the UVS bot
        if (newPresence.user.id !== UVS_BOT_ID) return;

        const status = newPresence.status; // 'online', 'offline', 'dnd', 'idle'
        const isOnline = status !== 'offline';
        const color = isOnline ? 0x00FF00 : 0xFF0000;
        const text = isOnline ? '🟢 **Online**' : '🔴 **Offline**';
        
        try {
            const channel = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
            if (!channel) return;

            const embed = new EmbedBuilder()
                .setTitle('🤖 UVS Bot Status')
                .setDescription(`Current Status: ${text}\nLast Updated: <t:${Math.floor(Date.now() / 1000)}:R>`)
                .setColor(color)
                .setTimestamp();

            // Use memory cache to find the message quickly
            if (statusMessageId) {
                const msg = await channel.messages.fetch(statusMessageId).catch(() => null);
                if (msg) {
                    await msg.edit({ embeds: [embed] });
                    return;
                }
            }
            
            // Search for existing status message by this bot to reuse it
            const messages = await channel.messages.fetch({ limit: 10 });
            const existingMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === '🤖 UVS Bot Status');
            
            if (existingMsg) {
                statusMessageId = existingMsg.id;
                await existingMsg.edit({ embeds: [embed] });
            } else {
                // Create a new one if it doesn't exist
                const newMsg = await channel.send({ embeds: [embed] });
                statusMessageId = newMsg.id;
            }
        } catch (error) {
            console.error('[UVS Status Monitor] Error updating status embed:', error);
        }
    }
};
