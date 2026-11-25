import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN
);

async function getCommands() {
    try {
        const commands = await rest.get(
            Routes.applicationCommands(process.env.CLIENT_ID)
        );

        for (const command of commands) {
            console.log(`${command.name}: ${command.id}`);
        }

    } catch (error) {
        console.error(error);
    }
}

getCommands();