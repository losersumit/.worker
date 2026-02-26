/**
 * syncDisplayNames.js
 * One-time sync on bot startup: fetches every NMC guild member's
 * current display name and writes it to players.display_name.
 */

const TARGET_GUILD_ID = '1448027116074434593';

/**
 * @param {import('discord.js').Client} client
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function syncDisplayNames(client, supabase) {
    console.log('[DISPLAYNAME-SYNC] Starting display name sync...');
    try {
        const guild = await client.guilds.fetch(TARGET_GUILD_ID);
        const members = await guild.members.fetch();

        // Build a map: discord_id → displayName
        const nameMap = {};
        members.forEach(m => { nameMap[m.user.id] = m.displayName; });

        // Fetch all players in this guild from Supabase
        const { data: players, error } = await supabase
            .from('players')
            .select('id, discord_id, display_name')
            .eq('guild_id', TARGET_GUILD_ID);

        if (error) {
            console.error('[DISPLAYNAME-SYNC] ❌ Failed to fetch players:', error.message);
            return;
        }
        if (!players || players.length === 0) {
            console.log('[DISPLAYNAME-SYNC] No players found in guild.');
            return;
        }

        // Only update rows where the display name has actually changed
        const toUpdate = players.filter(p => {
            const current = nameMap[p.discord_id];
            return current && current !== p.display_name;
        });

        if (toUpdate.length === 0) {
            console.log('[DISPLAYNAME-SYNC] ✅ All display names already up to date.');
            return;
        }

        console.log(`[DISPLAYNAME-SYNC] Updating ${toUpdate.length} player(s)...`);

        await Promise.all(
            toUpdate.map(p =>
                supabase
                    .from('players')
                    .update({ display_name: nameMap[p.discord_id] })
                    .eq('id', p.id)
            )
        );

        console.log(`[DISPLAYNAME-SYNC] ✅ Synced display names for ${toUpdate.length} player(s).`);
    } catch (err) {
        console.error('[DISPLAYNAME-SYNC] ❌ Unexpected error:', err.message);
    }
}
