import { Events } from 'discord.js';
import { supabase } from '../clients/supabase.js';

const ENLISTED_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1463184412937289973';
const TARGET_GUILD_ID = '1448027116074434593';

export default {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        // Only act on our target guild
        if (newMember.guild.id !== TARGET_GUILD_ID) return;

        // ─── 1. Enlisted role tracking ──────────────────────────
        const hadRole = oldMember.roles.cache.has(ENLISTED_ROLE_ID);
        const hasRole = newMember.roles.cache.has(ENLISTED_ROLE_ID);

        if (hadRole !== hasRole) {
            const action = hasRole ? 'added' : 'removed';
            console.log(`[ENLISTED] Role ${action} for ${newMember.user.tag}. Updating Supabase...`);

            try {
                await newMember.guild.members.fetch();
                const enlistedCount = newMember.guild.members.cache.filter(
                    m => m.roles.cache.has(ENLISTED_ROLE_ID)
                ).size;

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
        }

        // ─── 2. Avatar change tracking ──────────────────────────
        const oldAvatar = oldMember.user.avatar;
        const newAvatar = newMember.user.avatar;

        if (oldAvatar !== newAvatar) {
            const newPhotoUrl = newMember.user.displayAvatarURL({ size: 512, extension: 'png' });
            console.log(`[AVATAR] ${newMember.user.tag} changed avatar. Updating website_members...`);

            try {
                const { error } = await supabase
                    .from('website_members')
                    .update({ photo_url: newPhotoUrl })
                    .eq('discord_id', newMember.user.id);

                if (error) {
                    console.error('[AVATAR] ❌ Failed to update photo_url:', error.message);
                } else {
                    console.log(`[AVATAR] ✅ Updated photo_url for ${newMember.user.tag}`);
                }
            } catch (err) {
                console.error('[AVATAR] ❌ Unexpected error:', err);
            }
        }
    },
};
