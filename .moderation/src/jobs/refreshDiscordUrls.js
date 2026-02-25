/**
 * refreshDiscordUrls.js
 * Refreshes expiring Discord CDN attachment URLs every 12 hours.
 *
 * Discord attachment URLs expire after ~24 hours. This job:
 *  1. Reads all Discord CDN attachment URLs from media_gallery and partners
 *  2. Calls Discord's POST /attachments/refresh-urls endpoint in batches
 *  3. Updates the Supabase rows with the new fresh URLs
 */

const DISCORD_ATTACHMENT_REGEX = /https:\/\/cdn\.discordapp\.com\/attachments\//;
const BATCH_SIZE = 50; // Discord's max per request

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function refreshDiscordUrls(supabase) {
    console.log('[URL-REFRESH] Starting Discord CDN URL refresh...');
    const token = process.env.DISCORD_TOKEN;
    if (!token) { console.error('[URL-REFRESH] No DISCORD_TOKEN in env'); return; }

    // ── 1. Collect all expiring URLs from Supabase ─────────────────────────
    const tasks = [];

    // media_gallery: one URL per row
    const { data: media } = await supabase
        .from('media_gallery').select('id, media_url');
    (media || []).forEach(row => {
        if (DISCORD_ATTACHMENT_REGEX.test(row.media_url)) {
            tasks.push({ table: 'media_gallery', id: row.id, col: 'media_url', url: row.media_url });
        }
    });

    // partners: logo_url and bg_url
    const { data: partners } = await supabase
        .from('partners').select('id, logo_url, bg_url');
    (partners || []).forEach(row => {
        if (row.logo_url && DISCORD_ATTACHMENT_REGEX.test(row.logo_url)) {
            tasks.push({ table: 'partners', id: row.id, col: 'logo_url', url: row.logo_url });
        }
        if (row.bg_url && DISCORD_ATTACHMENT_REGEX.test(row.bg_url)) {
            tasks.push({ table: 'partners', id: row.id, col: 'bg_url', url: row.bg_url });
        }
    });

    if (tasks.length === 0) {
        console.log('[URL-REFRESH] No Discord attachment URLs found. Nothing to refresh.');
        return;
    }

    console.log(`[URL-REFRESH] Found ${tasks.length} URL(s) to refresh.`);

    // ── 2. Call Discord's refresh-urls endpoint in batches ─────────────────
    /** @type {Map<string, string>} original → refreshed */
    const refreshMap = new Map();

    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE).map(t => t.url);
        try {
            const res = await fetch('https://discord.com/api/v10/attachments/refresh-urls', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bot ' + token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ attachment_urls: batch }),
            });

            if (!res.ok) {
                const text = await res.text();
                console.error(`[URL-REFRESH] Discord API error ${res.status}: ${text}`);
                continue;
            }

            const json = await res.json();
            (json.refreshed_urls || []).forEach(entry => {
                refreshMap.set(entry.original, entry.refreshed);
            });
        } catch (err) {
            console.error('[URL-REFRESH] Fetch error:', err.message);
        }
    }

    // ── 3. Write refreshed URLs back to Supabase ───────────────────────────
    let updated = 0;
    for (const task of tasks) {
        const newUrl = refreshMap.get(task.url);
        if (!newUrl || newUrl === task.url) continue;

        const { error } = await supabase
            .from(task.table)
            .update({ [task.col]: newUrl })
            .eq('id', task.id);

        if (error) {
            console.error(`[URL-REFRESH] Failed to update ${task.table}#${task.id}.${task.col}:`, error.message);
        } else {
            updated++;
        }
    }

    console.log(`[URL-REFRESH] ✅ Done. ${updated}/${tasks.length} URL(s) refreshed.`);
}
