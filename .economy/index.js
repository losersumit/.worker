require('dotenv').config();
const { Client, IntentsBitField, Collection } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { applyDailyTax } = require('./utils/taxSystem');
const { initializeTables } = require('./utils/database');
const { setupGuildIncomeListener } = require('./utils/realtimeListener');

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMessages,
  ],
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Make supabase accessible globally
client.supabase = supabase;

// Command collection
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.name, command);
}

client.on('clientReady', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  initializeTables(supabase);

  // Set bot status to show help command
  client.user.setActivity('Type ?help for help.', {
    type: 4 // Type 4 is "Custom" activity
  });
  // Setup realtime listener for guild income updates
  if (process.env.GUILD_INCOME_CHANNEL_ID) {
    console.log(`[REALTIME] Initializing guild income channel listener...`);
    setupGuildIncomeListener(client, supabase, process.env.GUILD_ID, process.env.GUILD_INCOME_CHANNEL_ID);
  } else {
    console.log(`[REALTIME] GUILD_INCOME_CHANNEL_ID not set in .env - skipping realtime listener`);
  }

  // Schedule daily tax collection (runs at midnight every day)
  // To enable: uncomment the following code
  /*
  const schedule = require('node-schedule');
  schedule.scheduleJob('0 0 * * *', async () => {
    await applyDailyTax(client);
  });
  */

  const schedule = require('node-schedule');

  // Runs every day at 12:00 AM (Europe/London)
  const rule = new schedule.RecurrenceRule();
  rule.hour = 0;
  rule.minute = 0;
  rule.tz = 'Europe/London';

  schedule.scheduleJob(rule, async () => {
    console.log(`⏰ Running scheduled daily tax at 12:00 AM (London Time) - ${new Date().toISOString()}`);
    await applyDailyTax(client);
  });
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('?') || message.author.bot) return;

  // Check if message is from the economy channel
  if (message.channelId !== process.env.CHANNEL_ID) {
    // FIX: Add .catch() here so the bot doesn't crash if the message is deleted
    return message.reply('Economy commands can only be used in the designated economy channel!')
      .catch(err => console.log(`Could not reply to message (probably deleted): ${err.message}`));
  }

  // Check for Enlisted Driver role removed - Moved to specific commands (buy.js)

  const args = message.content.slice(1).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);

  if (!command) return;

  try {
    await command.execute(message, args, client);
  } catch (error) {
    console.error(error);
    message.reply('There was an error executing that command!');
  }
});

client.login(process.env.DISCORD_TOKEN);
