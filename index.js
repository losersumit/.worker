// Made by BonD
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Utilities from economy
import { setupGuildIncomeListener } from './.economy/utils/realtimeListener.js';
import { applyDailyTax } from './.economy/utils/taxSystem.js';
import { refreshDiscordUrls } from './.moderation/src/jobs/refreshDiscordUrls.js';
import { syncDisplayNames } from './.moderation/src/jobs/syncDisplayNames.js';
import { runMemoryCleanup } from './.moderation/src/systems/memoryCleanup.js';
import { scheduleRagHourlySummaries } from './.moderation/src/features/ragChat.js';
import { runInactivityScan } from './.moderation/src/jobs/inactivityScanner.js';
import schedule from 'node-schedule';

// AI Integration
// Note: AI bot features are now fully integrated via .moderation/src/features/ragChat.js

// Setup environment and paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

// Load environment variables via the moderation's loadEnv to ensure compatibility
import './.moderation/src/utils/loadEnv.js';

// Load moderation commands and events
import { commands as modCommands } from './.moderation/src/commands/index.js';
import { loadEvents } from './.moderation/src/handlers/eventHandler.js';

// Basic env validation
if (!process.env.DISCORD_TOKEN) {
    throw new Error('❌ Missing required env var: DISCORD_TOKEN');
}
if (!process.env.GROQ_API_KEY_ONE && !process.env.GROQ_API_KEY) {
    throw new Error('❌ Missing Groq key: set GROQ_API_KEY_ONE (or GROQ_API_KEY for backward compatibility)');
}

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Make supabase accessible globally
client.supabase = supabase;

// Command collection
client.commands = new Collection();           // Slash commands (.moderation)
client.legacyCommands = new Collection();     // Prefix commands (.economy)

// Register all slash commands
for (const command of modCommands) {
    client.commands.set(command.data.name, command);
}

// Register legacy text-based commands
const loadLegacyCommands = async () => {
    const commandsPath = path.join(__dirname, '.economy', 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // import() expects a file:// URL on Windows
        const commandModule = await import(`file://${filePath}`);
        const command = commandModule.default;
        if (command && command.name) {
            client.legacyCommands.set(command.name, command);
        }
    }
};

// Ready event handling
client.once('ready', async () => {
    console.log(`✅ Manager Bot logged in as ${client.user.tag}`);

    // Sync Discord display names to Supabase on startup
    syncDisplayNames(client, supabase).catch(err => console.error('[DISPLAYNAME-SYNC] Startup sync failed:', err));

    // Economy Init

    if (process.env.GUILD_INCOME_CHANNEL_ID) {
        console.log(`[REALTIME] Initializing guild income channel listener...`);
        setupGuildIncomeListener(client, supabase, process.env.GUILD_ID, process.env.GUILD_INCOME_CHANNEL_ID);
    }

    // Schedule daily tax collection
    const rule = new schedule.RecurrenceRule();
    rule.hour = 0;
    rule.minute = 0;
    rule.tz = 'Europe/London';

    schedule.scheduleJob(rule, async () => {
        console.log(`⏰ Running scheduled daily tax at 12:00 AM (London Time) - ${new Date().toISOString()}`);
        await applyDailyTax(client);
    });

    // Schedule daily memory cleanup at 4:00 AM
    schedule.scheduleJob('0 4 * * *', async () => {
        console.log(`⏰ [MEMORY-CLEANUP] Running daily memory consolidation - ${new Date().toISOString()}`);
        await runMemoryCleanup();
    });

    // Schedule daily inactivity scan at 1:00 AM
    schedule.scheduleJob('0 1 * * *', async () => {
        console.log(`⏰ [INACTIVITY] Running daily inactivity scan - ${new Date().toISOString()}`);
        await runInactivityScan(client, supabase);
    });

    // Run inactivity scan immediately on startup
    runInactivityScan(client, supabase).catch(err => console.error('[INACTIVITY] Startup scan failed:', err));

    // Refresh Discord CDN URLs every hour (well within Discord's 24h expiry window)
    schedule.scheduleJob('0 * * * *', async () => {
        console.log(`⏰ [URL-REFRESH] Running hourly CDN URL refresh - ${new Date().toISOString()}`);
        await refreshDiscordUrls(supabase, client);
    });

    // Run immediately on startup so the website has fresh URLs right away
    refreshDiscordUrls(supabase, client).catch(err => console.error('[URL-REFRESH] Startup run failed:', err));

    // Refresh Permanent Slot Machines
    import('./.economy/utils/postSlots.js').then(({ postPermanentSlots }) => {
        postPermanentSlots(client).catch(err => console.error('[SLOTS] Startup refresh failed:', err));
    }).catch(err => console.error('Failed to load postSlots script:', err));

    // Refresh Permanent Roulette Tables
    import('./.economy/utils/postRouletteTables.js').then(({ postPermanentRouletteTables }) => {
        postPermanentRouletteTables(client).catch(err => console.error('[ROULETTE] Startup refresh failed:', err));
    }).catch(err => console.error('Failed to load postRouletteTables script:', err));

    // Hourly RAG summaries for channel context retrieval
    scheduleRagHourlySummaries(client);
});

// Load events
const init = async () => {
    await loadLegacyCommands();
    await loadEvents(client);

    // messageCreate event is handled via loadEvents (which points to .moderation/src/events/messageCreate.js)

    // Log in to Discord
    client.login(process.env.DISCORD_TOKEN);
};

init();

