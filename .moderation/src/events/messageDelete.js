import { Events } from 'discord.js';

export default {
    name: Events.MessageDelete,
    async execute(message, client) {
        // Deleted message mod logging disabled
        return;
    },
};
