import { EmbedBuilder } from 'discord.js';

const STATUS_CHANNEL_ID = '1506715130019188866';
let statusMessageId = null;
let lastKnownStatus = 'online'; // Assume online by default
let activeSubscription = null;

export async function updateUvsEmbed(client) {
    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        let scanCount = 0;
        if (client.supabase) {
            const startOfDay = new Date();
            startOfDay.setUTCHours(0, 0, 0, 0);
            
            const { count, error } = await client.supabase
                .from('runs')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', startOfDay.toISOString());
                
            if (!error) scanCount = count || 0;
        }

        const isOnline = lastKnownStatus !== 'offline';
        const color = isOnline ? 0x00FF00 : 0xFF0000;
        const text = isOnline ? '🟢 **Online**' : '🔴 **Offline**';

        const embed = new EmbedBuilder()
            .setTitle('🤖 UVS Bot Status')
            .setDescription(`Current Status: ${text}\nTotal Jobs Scanned Today: **${scanCount}**\nLast Updated: <t:${Math.floor(Date.now() / 1000)}:R>`)
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

export function setUvsStatus(status, client) {
    lastKnownStatus = status;
    updateUvsEmbed(client);
}

export function setupUvsRunsListener(client, supabase) {
    console.log(`[UVS Monitor] 🔄 Initializing runs listener for UVS status`);

    if (activeSubscription) {
        try { activeSubscription.unsubscribe(); } catch (e) {}
    }

    activeSubscription = supabase
        .channel('uvs_status_runs_channel')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'runs' },
            (payload) => {
                console.log('[UVS Monitor] ⚡ Received INSERT on runs. Updating embed...');
                updateUvsEmbed(client);
            }
        )
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log(`[UVS Monitor] ✅ Connected! Listening for run inserts.`);
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.log(`[UVS Monitor] 🔌 Disconnected/Error. Reconnecting in 10m...`);
                setTimeout(() => setupUvsRunsListener(client, supabase), 600000);
            }
        });
}
