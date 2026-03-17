import { Client, GatewayIntentBits, AttachmentBuilder } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDefaultSlotEmbed, createDefaultSlotRow } from '../interactions/slotMachineInteraction.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function postPermanentSlots(client) {
    const channelId = process.env.SLOTS_CHANNEL_ID;
    if (!channelId) {
        console.error('SLOTS_CHANNEL_ID is not defined in .env');
        return;
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        console.log(`[SLOTS] Refreshing slot machines in channel: ${channel.name}...`);

        const messages = await channel.messages.fetch({ limit: 50 });
        const oldMachines = Array.from(
            messages.filter((m) => m.author.id === client.user.id && m.embeds[0] && m.embeds[0].title?.includes('Slot Machine #')).values()
        ).sort((a, b) => a.embeds[0].title.localeCompare(b.embeds[0].title));

        const slotImage = path.join(process.cwd(), 'slot_machine.png');
        const attachment = new AttachmentBuilder(slotImage, { name: 'slot_machine.png' });

        if (oldMachines.length === 5) {
            console.log('[SLOTS] Found 5 existing slot machines. Updating them in-place...');
            for (let i = 0; i < 5; i++) {
                await oldMachines[i].edit({
                    embeds: [createDefaultSlotEmbed(i + 1)],
                    components: [createDefaultSlotRow(i + 1)],
                    files: [attachment]
                });
            }
        } else {
            console.log(`[SLOTS] Machine count mismatch (${oldMachines.length}/5). Deleting and re-posting...`);
            if (oldMachines.length > 0) {
                await channel.bulkDelete(oldMachines);
            }
            for (let i = 1; i <= 5; i++) {
                await channel.send({
                    embeds: [createDefaultSlotEmbed(i)],
                    components: [createDefaultSlotRow(i)],
                    files: [attachment]
                });
            }
        }

        console.log('[SLOTS] 5 slot machines refreshed successfully!');
    } catch (error) {
        console.error('[SLOTS] Error refreshing slot machines:', error);
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
        console.log(`Logged in as ${tClient.user.tag}`);
        await postPermanentSlots(tClient);
        process.exit(0);
    });

    tClient.login(process.env.DISCORD_TOKEN);
}
