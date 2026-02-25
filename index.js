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
import schedule from 'node-schedule';

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

    // Refresh Discord CDN URLs every 12 hours (00:00 and 12:00 UTC)
    schedule.scheduleJob('0 0,12 * * *', async () => {
        console.log(`⏰ [URL-REFRESH] Running scheduled CDN URL refresh - ${new Date().toISOString()}`);
        await refreshDiscordUrls(supabase);
    });

    // Also run immediately on startup so URLs are fresh from the moment the bot starts
    refreshDiscordUrls(supabase).catch(err => console.error('[URL-REFRESH] Startup run failed:', err));
});

// Load events
const init = async () => {
    await loadLegacyCommands();
    await loadEvents(client);

    // Log in to Discord
    client.login(process.env.DISCORD_TOKEN);
};

init();
