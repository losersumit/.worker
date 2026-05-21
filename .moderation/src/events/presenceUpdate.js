import { Events } from 'discord.js';
import { setUvsStatus } from '../systems/uvsStatusMonitor.js';

const UVS_BOT_ID = '1464033910726988011';

export default {
    name: Events.PresenceUpdate,
    async execute(oldPresence, newPresence, client) {
        if (!newPresence || !newPresence.user) return;
        
        // We only care about the UVS bot
        if (newPresence.user.id !== UVS_BOT_ID) return;

        setUvsStatus(newPresence.status, client);
    }
};
