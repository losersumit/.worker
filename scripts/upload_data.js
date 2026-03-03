import dotenv from "dotenv";
import { Client, GatewayIntentBits } from "discord.js";
import fs from "fs";
import path from "path";
import readline from "readline";

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TOKEN = process.env.DISCORD_TOKEN;

const CHANNEL_ID = "1471842369388154910";
const THREAD_ID = ""; // optional

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

async function askPaths() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const paths = [];

    console.log("\nPaste file/folder paths.");
    console.log("Press ENTER on empty line when done.\n");

    for await (const line of rl) {
        let value = line.trim();
        if (!value) break;

        // remove starting & ending quotes if present
        value = value.replace(/^"(.*)"$/, "$1");

        paths.push(value);
    }

    rl.close();
    return paths;
}


client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) throw new Error("Channel not found");

        let target = channel;

        if (THREAD_ID && THREAD_ID.trim() !== "") {
            const thread = await channel.threads.fetch(THREAD_ID);
            if (!thread) throw new Error("Thread not found");
            target = thread;
            console.log("Sending to thread");
        } else {
            console.log("Sending to channel");
        }

        // ===== ASK USER =====
        const INPUT_PATHS = await askPaths();

        if (!INPUT_PATHS.length) {
            console.log("No paths provided.");
            process.exit(0);
        }
        // ====================

        let fileList = [];

        for (const inputPath of INPUT_PATHS) {
            const resolvedPath = path.resolve(inputPath);

            if (!fs.existsSync(resolvedPath)) {
                console.log(`Path not found: ${resolvedPath}`);
                continue;
            }

            const stat = fs.lstatSync(resolvedPath);

            if (stat.isFile()) {
                fileList.push(resolvedPath);
            } else if (stat.isDirectory()) {
                const files = fs.readdirSync(resolvedPath);
                for (const file of files) {
                    const filePath = path.join(resolvedPath, file);
                    if (fs.lstatSync(filePath).isFile()) {
                        fileList.push(filePath);
                    }
                }
            }
        }

        if (!fileList.length) {
            console.log("No files found.");
            process.exit(0);
        }

        let count = 0;

        for (const filePath of fileList) {
            count++;
            console.log(`Uploading ${count}/${fileList.length}: ${path.basename(filePath)}`);

            await target.send({
                files: [filePath],
            });
        }

        console.log("Finished uploading.");
    } catch (err) {
        console.error("Error:", err.message);
    }

    client.destroy();
});

client.login(TOKEN);
