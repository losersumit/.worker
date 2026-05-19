import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import readline from 'readline';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Load env
dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

async function main() {
    console.log('--- Webhook Message Updater (JSON Source) ---');
    console.log('This script updates a message using a local JSON file as payload.\n');

    try {
        // 1. Get Webhook URL from User Input
        const webhookUrl = await askQuestion('Enter Webhook URL (leave empty to use Bot Token instead): ');

        // Parse URL
        let webhookId, webhookToken;
        if (webhookUrl && webhookUrl.trim()) {
            const parts = webhookUrl.split('webhooks/')[1].split('/');
            webhookId = parts[0];
            webhookToken = parts[1];
        }

        // 2. Get Message Link
        const messageLink = await askQuestion('Enter Message Link to edit (leave empty to send a new message): ');
        let messageId = null;
        if (messageLink.trim()) {
            messageId = messageLink.split('/').pop();
        }

        // 3. Get JSON File Path
        let jsonPath = await askQuestion('Enter path to JSON file (e.g. ./message.json): ');

        // Resolve absolute path if needed, or handle relative
        // Remove quotes if user dragged file in terminal
        jsonPath = jsonPath.replace(/^"|"$/g, '').trim();

        console.log(`\nReading JSON from: ${jsonPath}`);

        let payload;
        try {
            const rawData = await fs.readFile(jsonPath, 'utf-8');
            payload = JSON.parse(rawData);
        } catch (err) {
            console.error(`❌ Error reading/parsing JSON file: ${err.message}`);
            process.exit(1);
        }

        // 3.5 Find referenced attachments in JSON
        function findAttachments(obj, urls = new Set()) {
            if (typeof obj === 'string') {
                if (obj.startsWith('attachment://')) urls.add(obj.substring(13));
            } else if (Array.isArray(obj)) {
                obj.forEach(item => findAttachments(item, urls));
            } else if (obj !== null && typeof obj === 'object') {
                Object.values(obj).forEach(val => findAttachments(val, urls));
            }
            return Array.from(urls);
        }

        const requiredAttachments = findAttachments(payload);
        const requestOptions = { body: payload, files: [] };

        if (!payload.attachments) {
            payload.attachments = [];
        }

        if (requiredAttachments.length > 0) {
            console.log(`\nThis payload references ${requiredAttachments.length} attachment(s): ${requiredAttachments.join(', ')}`);
        }

        let attachmentsInput = await askQuestion('\nEnter path(s) to attachment(s), separated by comma (leave empty to skip):\n> ');

        if (attachmentsInput.trim()) {
            const paths = attachmentsInput.split(',').map(p => p.trim().replace(/^["']|["']$/g, '')).filter(p => p);

            for (let i = 0; i < paths.length; i++) {
                const filePath = paths[i];
                try {
                    const fileName = path.basename(filePath);
                    const fileBuffer = await fs.readFile(filePath);

                    requestOptions.files.push({
                        name: fileName,
                        data: fileBuffer
                    });

                    // To make `attachment://filename.png` work, the payload attachment `id` doesn't strictly need to be a number.
                    // Discord maps files by checking embed `url` -> attachment `id` or matching `filename`. 
                    // However, sometimes it requires `id: 0`, but we will map the embeds dynamically.
                    payload.attachments.push({
                        id: i.toString(),
                        filename: fileName
                    });

                    // Ensure embeds update `attachment://name` appropriately to point to this `id`
                    if (payload.embeds) {
                        payload.embeds.forEach(embed => {
                            if (embed.thumbnail && embed.thumbnail.url === `attachment://${fileName}`) {
                                embed.thumbnail.url = `attachment://${i}`;
                            }
                            if (embed.image && embed.image.url === `attachment://${fileName}`) {
                                embed.image.url = `attachment://${i}`;
                            }
                        });
                    }

                } catch (err) {
                    console.error(`❌ Error reading ${filePath}: ${err.message}`);
                    process.exit(1);
                }
            }
        } else if (requiredAttachments.length > 0) {
            console.log('Skipping attachments...');
        }

        // 4. Send Update or New Message
        if (webhookUrl && webhookUrl.trim()) {
            console.log(messageId ? 'Sending update to Discord via Webhook...' : 'Sending new message to Discord via Webhook...');

            const parts = webhookUrl.split('webhooks/')[1].split('/');
            const webhookId = parts[0];
            const webhookToken = parts[1];

            const rest = new REST({ version: '10' }).setToken(webhookToken);

            if (messageId) {
                const route = Routes.webhookMessage(webhookId, webhookToken, messageId);

                if (payload.embeds && payload.embeds.length === 0) {
                    delete payload.embeds;
                }

                if (payload.content === "") {
                    delete payload.content;
                }

                try {
                    await rest.patch(route, requestOptions);
                } catch (e) {
                    if (e.code === 50035 && e.rawError && JSON.stringify(e.rawError.errors).includes('MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2')) {
                        console.log('🔄 Detected legacy->V2 transition error. Pre-clearing legacy message...');
                        const preClearPayload = {
                            content: payload.content || "\u200b",
                            embeds: [],
                            components: []
                        };
                        await rest.patch(route, { body: preClearPayload });

                        console.log('✅ Pre-clear successful. Applying V2 payload...');
                        await rest.patch(route, requestOptions);
                    } else {
                        throw e;
                    }
                }

                console.log('✅ Message updated successfully from JSON source!');
            } else {
                const route = Routes.webhook(webhookId, webhookToken);
                requestOptions.query = new URLSearchParams({ wait: 'true' });
                const response = await rest.post(route, requestOptions);
                console.log(`✅ New message sent successfully! Message ID: ${response.id}`);
            }
        } else {
            // Send via Bot Token
            const botToken = process.env.DISCORD_TOKEN;
            if (!botToken) {
                console.error('❌ Error: DISCORD_TOKEN not found in .env and no Webhook URL provided.');
                process.exit(1);
            }

            const channelId = await askQuestion('Enter Channel ID to send/edit the message in: ');
            if (!channelId || !channelId.trim()) {
                console.error('❌ Error: Channel ID is required when not using a webhook.');
                process.exit(1);
            }

            console.log(messageId ? 'Sending update to Discord via Bot...' : 'Sending new message to Discord via Bot...');

            // Set token as 'Bot TOKEN'
            const rest = new REST({ version: '10' }).setToken(botToken);

            if (messageId) {
                const route = Routes.channelMessage(channelId.trim(), messageId);

                if (payload.embeds && payload.embeds.length === 0) {
                    delete payload.embeds;
                }
                if (payload.content === "") {
                    delete payload.content;
                }

                await rest.patch(route, requestOptions);
                console.log('✅ Message updated successfully via Bot account!');
            } else {
                const route = Routes.channelMessages(channelId.trim());
                const response = await rest.post(route, requestOptions);
                console.log(`✅ New message sent successfully via Bot account! Message ID: ${response.id}`);
            }
        }

    } catch (error) {
        console.error('❌ An error occurred:', error);
    } finally {
        rl.close();
        process.exit(0);
    }
}

main();
