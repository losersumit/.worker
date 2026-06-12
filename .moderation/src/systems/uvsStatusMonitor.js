import { EmbedBuilder } from 'discord.js';

const STATUS_CHANNEL_ID = '1506715130019188866';
let statusMessageId = null;
let lastKnownStatus = 'online'; // Assume online by default
let activeSubscription = null;
let resetTimeout = null;

// Helper to get 00:00:00 London time zone for the current day in UTC
function getLondonStartOfDay() {
    const now = new Date();
    
    // Get London year, month, day
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/London',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    });
    
    const parts = {};
    formatter.formatToParts(now).forEach(p => {
        if (p.type !== 'literal') parts[p.type] = p.value;
    });
    
    // Construct UTC midnight corresponding to London local parts
    const utcMidnightOfLondonLocal = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
    
    // Find timezone offset difference at that time
    const d1 = new Date(utcMidnightOfLondonLocal);
    const d2Parts = {};
    formatter.formatToParts(d1).forEach(p => {
        if (p.type !== 'literal') d2Parts[p.type] = p.value;
    });
    
    const d2Utc = Date.UTC(d2Parts.year, d2Parts.month - 1, d2Parts.day, d2Parts.hour, d2Parts.minute, d2Parts.second);
    const diff = d2Utc - utcMidnightOfLondonLocal;
    
    return new Date(utcMidnightOfLondonLocal - diff);
}

// Helper to calculate milliseconds until the next London midnight
function getMillisUntilNextLondonMidnight() {
    const now = new Date();
    
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/London',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    });
    
    const parts = {};
    formatter.formatToParts(now).forEach(p => {
        if (p.type !== 'literal') parts[p.type] = p.value;
    });
    
    const todayMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
    
    const d1 = new Date(todayMidnightUtc);
    const d2Parts = {};
    formatter.formatToParts(d1).forEach(p => {
        if (p.type !== 'literal') d2Parts[p.type] = p.value;
    });
    const d2Utc = Date.UTC(d2Parts.year, d2Parts.month - 1, d2Parts.day, d2Parts.hour, d2Parts.minute, d2Parts.second);
    const diff = d2Utc - todayMidnightUtc;
    
    const londonMidnightToday = new Date(todayMidnightUtc - diff);
    const londonMidnightNext = new Date(londonMidnightToday.getTime() + 24 * 60 * 60 * 1000);
    
    return Math.max(0, londonMidnightNext.getTime() - now.getTime());
}

export async function updateUvsEmbed(client) {
    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        let scanCount = 0;
        let totalScanCount = 0;

        if (client.supabase) {
            const startOfDay = getLondonStartOfDay();
            
            const [todayRes, totalRes] = await Promise.all([
                client.supabase
                    .from('runs')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', startOfDay.toISOString()),
                client.supabase
                    .from('runs')
                    .select('*', { count: 'exact', head: true })
            ]);
                
            if (!todayRes.error) scanCount = todayRes.count || 0;
            if (!totalRes.error) totalScanCount = totalRes.count || 0;
        }

        const isOnline = lastKnownStatus !== 'offline';
        const color = isOnline ? 0x00FF00 : 0xFF0000;
        const text = isOnline ? '🟢 **Online**' : '🔴 **Offline**';

        const embed = new EmbedBuilder()
            .setTitle('🤖 UVS Bot Status')
            .setDescription(`Current Status: ${text}\nTotal Jobs Scanned Today: **${scanCount}**\nTotal Jobs Scanned: **${totalScanCount}**\nLast Updated: <t:${Math.floor(Date.now() / 1000)}:R>`)
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

function scheduleMidnightReset(client) {
    if (resetTimeout) clearTimeout(resetTimeout);
    
    const delay = getMillisUntilNextLondonMidnight();
    console.log(`[UVS Monitor] Scheduled midnight reset in ${(delay / 1000 / 60).toFixed(2)} minutes`);
    
    resetTimeout = setTimeout(() => {
        console.log('[UVS Monitor] ⏰ London midnight reached. Updating status embed...');
        updateUvsEmbed(client);
        scheduleMidnightReset(client);
    }, delay);
}

export function setupUvsRunsListener(client, supabase) {
    console.log(`[UVS Monitor] 🔄 Initializing runs listener for UVS status`);

    // Schedule the midnight reset
    scheduleMidnightReset(client);

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
