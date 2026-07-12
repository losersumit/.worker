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
            
            // Collect all candidate URLs from attachments and embeds
            const candidates = [];
            if (message.attachments) {
                message.attachments.forEach(att => {
                    if (att.url) candidates.push(att.url);
                });
            }
            if (message.embeds) {
                message.embeds.forEach(embed => {
                    if (embed.image?.url) candidates.push(embed.image.url);
                    if (embed.thumbnail?.url) candidates.push(embed.thumbnail.url);
                    if (embed.video?.url) candidates.push(embed.video.url);
                });
            }

            if (candidates.length === 0) {
                console.warn(`[URL-REFRESH] Row ${row.id}: message has no attachments or embeds. Skipping.`);
                continue;
            }

            // Get base URL helper
            const getBaseUrl = (url) => {
                if (!url) return '';
                try {
                    const parsed = new URL(url);
                    return parsed.origin + parsed.pathname;
                } catch {
                    return url.split('?')[0];
                }
            };

            const targetBase = getBaseUrl(row.media_url);
            let newUrl = candidates.find(c => getBaseUrl(c) === targetBase);

            if (!newUrl) {
                console.warn(`[URL-REFRESH] Row ${row.id}: No exact base URL match found. Falling back to first available URL.`);
                newUrl = candidates[0];
            }

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

    console.log(`[URL-REFRESH] Done. Updated: ${updated} | Failed: ${failed} | Total: ${eligible.length}`);
}
