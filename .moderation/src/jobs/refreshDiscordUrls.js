/**
 * refreshDiscordUrls.js
 * Refreshes Discord CDN attachment URLs by re-fetching the original messages.
 *
 * Discord attachment URLs expire after ~24 hours.
 * Since the message itself never expires, fetching it via the Discord API
 * always returns a fresh, valid attachment URL.
 *
 * Runs every 23 hours (scheduled in index.js), covering the 24-hour window safely.
 */

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

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

    console.log(`[URL-REFRESH] Refreshing ${eligible.length} row(s)...`);
    let updated = 0;
    let failed = 0;

    for (const row of eligible) {
        try {
            const channel = await client.channels.fetch(row.channel_id);
            const message = await channel.messages.fetch(row.message_id);
            const attachment = message.attachments.first();

            if (!attachment) {
                console.warn(`[URL-REFRESH] Row ${row.id}: message has no attachment anymore.`);
                continue;
            }

            const newUrl = attachment.url;

            // Only update if the base path changed (ignore query params like ex= timestamp)
            const basePath = (url) => url.split('?')[0];
            if (basePath(newUrl) === basePath(row.media_url)) continue;

            const { error: updateErr } = await supabase
                .from('media_gallery')
                .update({ media_url: newUrl })
                .eq('id', row.id);

            if (updateErr) {
                console.error(`[URL-REFRESH] Failed to update row ${row.id}:`, updateErr.message);
                failed++;
            } else {
                updated++;
            }
        } catch (err) {
            console.error(`[URL-REFRESH] Could not fetch message for row ${row.id}:`, err.message);
            failed++;
        }
    }

    console.log(`[URL-REFRESH] ✅ Done. Updated: ${updated} | Failed: ${failed} | Total: ${eligible.length}`);
}
