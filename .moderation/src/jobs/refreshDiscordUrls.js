/**
 * refreshDiscordUrls.js
 * Refreshes Discord CDN attachment URLs by re-fetching the original messages.
 *
 * Discord CDN URLs for the same file always share the same base path —
 * only the query-string tokens (ex=, is=, hm=) carry the new expiry.
 * So we ALWAYS write the fresh URL back to Supabase; no comparison needed.
 *
 * Runs on bot startup + every 23 hours via node-schedule.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('discord.js').Client} client
 */
export async function refreshDiscordUrls(supabase, client) {
    console.log('[URL-REFRESH] Starting Discord CDN URL refresh via message re-fetch...');

    // Fetch all media_gallery rows that have a stored message reference
    const { data: rows, error } = await supabase
        .from('media_gallery')
        .select('id, channel_id, message_id, media_url');

    if (error) {
        console.error('[URL-REFRESH] Supabase fetch error:', error.message);
        return;
    }

    const eligible = (rows || []).filter(r => r.channel_id && r.message_id);
    if (eligible.length === 0) {
        console.log('[URL-REFRESH] No rows with message references. Nothing to refresh.');
        return;
    }

    console.log(`[URL-REFRESH] Force-refreshing ${eligible.length} row(s)...`);
    let updated = 0;
    let failed = 0;

    for (const row of eligible) {
        try {
            const channel = await client.channels.fetch(row.channel_id);
            const message = await channel.messages.fetch(row.message_id);
            const attachment = message.attachments.first();

            if (!attachment) {
                console.warn(`[URL-REFRESH] Row ${row.id}: message has no attachment. Skipping.`);
                continue;
            }

            // ALWAYS write the fresh URL — the expiry tokens in the query-string
            // change every time, so comparing base paths would always say "no change".
            const newUrl = attachment.url;

            const { error: updateErr } = await supabase
                .from('media_gallery')
                .update({ media_url: newUrl })
                .eq('id', row.id);

            if (updateErr) {
                console.error(`[URL-REFRESH] Failed to update row ${row.id}:`, updateErr.message);
                failed++;
            } else {
                console.log(`[URL-REFRESH] ✅ Row ${row.id}: URL refreshed.`);
                updated++;
            }
        } catch (err) {
            console.error(`[URL-REFRESH] Could not fetch message for row ${row.id}:`, err.message);
            failed++;
        }
    }

    console.log(`[URL-REFRESH] Done. Updated: ${updated} | Failed: ${failed} | Total: ${eligible.length}`);
}
