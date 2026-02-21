/**
 * Discord AI Moderation Bot
 * 
 * Made By Friday | Powered By Cortex Realm 
 * Support Server: https://discord.gg/EWr3GgP6fe
 * 
 * Copyright (c) 2025 Friday | Cortex Realm
 * License: MIT
 */

import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import './src/utils/loadEnv.js';
import { commands } from './src/commands/index.js';
import { loadEvents } from './src/handlers/eventHandler.js';

// Basic env validation (single Discord token, two Groq keys supported)
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
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Collection for slash commands
client.commands = new Collection();

// Register all commands
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

// Load events
await loadEvents(client);

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
