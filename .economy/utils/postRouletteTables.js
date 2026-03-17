import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { defaultRouletteEmbed, defaultRouletteRows } from '../interactions/rouletteTableInteraction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function postPermanentRouletteTables(client) {
    const channelId = process.env.ROULETTE_CHANNEL_ID;
    if (!channelId) {
        console.error('ROULETTE_CHANNEL_ID is not defined in .env');
        return;
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        console.log(`[ROULETTE] Refreshing roulette tables in channel: ${channel.name}...`);
        const messages = await channel.messages.fetch({ limit: 30 });
        const oldTables = Array.from(
            messages.filter((m) => m.author.id === client.user.id && m.embeds[0] && m.embeds[0].title?.includes('Roulette Table #')).values()
        ).sort((a, b) => a.embeds[0].title.localeCompare(b.embeds[0].title));

        if (oldTables.length === 2) {
            for (let i = 0; i < 2; i++) {
                await oldTables[i].edit({ embeds: [defaultRouletteEmbed(i + 1)], components: defaultRouletteRows(i + 1) });
            }
        } else {
            if (oldTables.length > 0) {
                await channel.bulkDelete(oldTables);
            }
            for (let i = 1; i <= 2; i++) {
                await channel.send({ embeds: [defaultRouletteEmbed(i)], components: defaultRouletteRows(i) });
            }
        }

        console.log('[ROULETTE] 2 roulette tables refreshed successfully!');
    } catch (error) {
        console.error('[ROULETTE] Error refreshing roulette tables:', error);
    }
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
    if (!process.env.DISCORD_TOKEN) {
        console.error('Missing DISCORD_TOKEN');
        process.exit(1);
    }

    const tClient = new Client({ intents: [GatewayIntentBits.Guilds] });
    tClient.once('ready', async () => {
        await postPermanentRouletteTables(tClient);
        process.exit(0);
    });
    tClient.login(process.env.DISCORD_TOKEN);
}
