import { Events } from 'discord.js';
import { supabase } from '../clients/supabase.js';

const ENLISTED_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1463184412937289973';
const TARGET_GUILD_ID = '1448027116074434593';

export default {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        // Only act on our target guild
        if (newMember.guild.id !== TARGET_GUILD_ID) return;

        const hadRole = oldMember.roles.cache.has(ENLISTED_ROLE_ID);
        const hasRole = newMember.roles.cache.has(ENLISTED_ROLE_ID);

        // Only act if the enlisted role was added or removed
        if (hadRole === hasRole) return;

        const action = hasRole ? 'added' : 'removed';
        console.log(`[ENLISTED] Role ${action} for ${newMember.user.tag}. Updating Supabase...`);

        try {
            // Count ALL members who currently have the enlisted role
            const guild = newMember.guild;

            // Fetch all members (cache should be populated via GuildMembers intent)
            await guild.members.fetch();
            const enlistedCount = guild.members.cache.filter(
                m => m.roles.cache.has(ENLISTED_ROLE_ID)
            ).size;

            console.log(`[ENLISTED] Current enlisted count: ${enlistedCount}`);

            // Update approved_guilds.enlisted_drivers
            const { error } = await supabase
                .from('approved_guilds')
                .update({ enlisted_drivers: enlistedCount })
                .eq('guild_id', TARGET_GUILD_ID);

            if (error) {
                console.error('[ENLISTED] ❌ Failed to update Supabase:', error.message);
            } else {
                console.log(`[ENLISTED] ✅ Updated enlisted_drivers to ${enlistedCount}`);
            }
        } catch (err) {
            console.error('[ENLISTED] ❌ Unexpected error:', err);
        }
    },
};
