import { Events } from 'discord.js';
import { supabase } from '../clients/supabase.js';

const ENLISTED_ROLE_ID = process.env.ENLISTED_ROLE_ID || '1482386008376086598';
const AP_ROLE_ID = process.env.AP_ROLE_ID || '1463184412937289973';
const RP_ROLE_ID = process.env.RP_ROLE_ID || '1482059608536387795';
const TARGET_GUILD_ID = process.env.GUILD_ID || '1448027116074434593';

export default {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        if (newMember.guild.id !== TARGET_GUILD_ID) return;

        const hadEnlisted = oldMember.roles.cache.has(ENLISTED_ROLE_ID);
        const hasEnlisted = newMember.roles.cache.has(ENLISTED_ROLE_ID);

        const hadAP = oldMember.roles.cache.has(AP_ROLE_ID);
        const hasAP = newMember.roles.cache.has(AP_ROLE_ID);

        const hadRP = oldMember.roles.cache.has(RP_ROLE_ID);
        const hasRP = newMember.roles.cache.has(RP_ROLE_ID);

        const oldNick = oldMember.displayName;
        const newNick = newMember.displayName;
        
        const oldAvatar = oldMember.user.avatar;
        const newAvatar = newMember.user.avatar;

        // Ensure display_name updates in `players` table as before
        if (oldNick !== newNick) {
            try {
                await supabase.from('players').update({ display_name: newNick }).eq('discord_id', newMember.user.id);
            } catch (err) {
                console.error('[DISPLAYNAME] Update error:', err);
            }
        }

        // Logic for returning the correct status based on roles
        const determineStatus = () => {
            if (hasAP) return 'AP';
            if (hasRP) return 'RP';
            return null; // fallback
        };

        // 1. ADDED ENLISTED ROLE -> Add to enlisted_drivers
        if (!hadEnlisted && hasEnlisted) {
            console.log(`[ENLISTED] ${newMember.user.tag} gained enlisted role, adding to table...`);
            try {
                // Fetch unit number from players table
                const { data: playerData } = await supabase
                    .from('players')
                    .select('registration_number')
                    .eq('discord_id', newMember.user.id)
                    .single();

                const unitNumber = playerData ? playerData.registration_number : null;
                const status = determineStatus();
                const photoUrl = newMember.user.displayAvatarURL({ size: 512, extension: 'png' });

                await supabase.from('enlisted_drivers').upsert({
                    discord_id: newMember.user.id,
                    display_name: newNick,
                    unit_number: unitNumber,
                    status: status,
                    photo_url: photoUrl
                }, { onConflict: 'discord_id' });
                
                console.log(`[ENLISTED] ✅ Added ${newMember.user.tag} to enlisted_drivers`);
            } catch (err) {
                console.error('[ENLISTED] ❌ Failed to insert:', err);
            }
        }

        // 2. REMOVED ENLISTED ROLE -> Remove from enlisted_drivers
        else if (hadEnlisted && !hasEnlisted) {
            console.log(`[ENLISTED] ${newMember.user.tag} lost enlisted role, removing from table...`);
            try {
                await supabase.from('enlisted_drivers').delete().eq('discord_id', newMember.user.id);
                console.log(`[ENLISTED] ✅ Removed ${newMember.user.tag} from enlisted_drivers`);
            } catch (err) {
                console.error('[ENLISTED] ❌ Failed to delete:', err);
            }
        }

        // 3. MAINTAINING ENLISTED ROLE -> Check for updates to status, nickname, or avatar
        else if (hasEnlisted) {
            const updates = {};
            
            if (hadAP !== hasAP || hadRP !== hasRP) {
                updates.status = determineStatus();
            }
            if (oldNick !== newNick) {
                updates.display_name = newNick;
            }
            if (oldAvatar !== newAvatar) {
                updates.photo_url = newMember.user.displayAvatarURL({ size: 512, extension: 'png' });
            }

            if (Object.keys(updates).length > 0) {
                console.log(`[ENLISTED] ${newMember.user.tag} updating enlisted_drivers details...`);
                try {
                    await supabase.from('enlisted_drivers').update(updates).eq('discord_id', newMember.user.id);
                    console.log(`[ENLISTED] ✅ Details updated for ${newMember.user.tag}`);
                } catch (err) {
                    console.error('[ENLISTED] ❌ Failed to update details:', err);
                }
            }
        }
    },
};
