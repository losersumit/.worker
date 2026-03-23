/**
 * refreshProfilePictures.js
 * Refreshes Discord profile pictures (avatar URLs) for enlisted_drivers and website_members.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('discord.js').Client} client
 */
export async function refreshProfilePictures(supabase, client) {
    console.log('[AVATAR-REFRESH] Starting profile picture refresh...');

    try {
        // 1. Refresh enlisted_drivers
        const { data: drivers, error: driversError } = await supabase
            .from('enlisted_drivers')
            .select('discord_id');

        if (driversError) {
            console.error('[AVATAR-REFRESH] Failed to fetch enlisted_drivers:', driversError.message);
        } else if (drivers) {
            console.log(`[AVATAR-REFRESH] Updating ${drivers.length} drivers...`);
            for (const driver of drivers) {
                if (!driver.discord_id) continue;
                try {
                    const user = await client.users.fetch(driver.discord_id);
                    const photoUrl = user.displayAvatarURL({ extension: 'png', size: 1024 });
                    
                    await supabase
                        .from('enlisted_drivers')
                        .update({ photo_url: photoUrl })
                        .eq('discord_id', driver.discord_id);
                } catch (err) {
                    console.warn(`[AVATAR-REFRESH] Could not fetch/update avatar for driver ${driver.discord_id}:`, err.message);
                }
            }
        }

        // 2. Refresh website_members
        const { data: members, error: membersError } = await supabase
            .from('website_members')
            .select('id, discord_id');

        if (membersError) {
            console.error('[AVATAR-REFRESH] Failed to fetch website_members:', membersError.message);
        } else if (members) {
            console.log(`[AVATAR-REFRESH] Updating ${members.length} website members...`);
            for (const member of members) {
                if (!member.discord_id) continue;
                try {
                    const user = await client.users.fetch(member.discord_id);
                    const photoUrl = user.displayAvatarURL({ extension: 'png', size: 1024 });
                    
                    await supabase
                        .from('website_members')
                        .update({ photo_url: photoUrl })
                        .eq('id', member.id);
                } catch (err) {
                    console.warn(`[AVATAR-REFRESH] Could not fetch/update avatar for member ${member.discord_id}:`, err.message);
                }
            }
        }

        console.log('[AVATAR-REFRESH] Profile picture refresh completed.');
    } catch (err) {
        console.error('[AVATAR-REFRESH] Critical error during refresh:', err);
    }
}
