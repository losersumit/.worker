/**
 * emailPoller.js
 * ─────────────────────────────────────────────────────────────
 * Polls the Gmail inbox (nmc.logistics.eu@gmail.com) every 5
 * minutes via IMAP and posts any new/unread emails forwarded
 * from contact@nmc-logistics.xyz into the Bond's Cabin channel.
 * ─────────────────────────────────────────────────────────────
 */

import { ImapFlow } from 'imapflow';
import { EmbedBuilder } from 'discord.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const GMAIL_EMAIL    = process.env.GMAIL_EMAIL;
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const CABIN_ID       = process.env.BONDS_CABIN_CHANNEL_ID;

// ── Helpers ────────────────────────────────────────────────────
function truncate(str, max = 1024) {
    if (!str) return '*No content*';
    const clean = str.replace(/\r?\n{3,}/g, '\n\n').trim();
    return clean.length > max ? clean.slice(0, max - 3) + '…' : clean;
}

function formatSender(from) {
    if (!from?.value?.length) return 'Unknown';
    const { name, address } = from.value[0];
    return name ? `${name} <${address}>` : address;
}

let polling = false; // prevent concurrent polls

async function pollInbox(client) {
    if (!GMAIL_EMAIL || !GMAIL_PASSWORD) return;
    if (!CABIN_ID) return;
    if (polling) return; // skip if previous poll still running
    polling = true;

    const cabin = await client.channels.fetch(CABIN_ID).catch(() => null);
    if (!cabin) { polling = false; return; }

    const imap = new ImapFlow({
        host:   'imap.gmail.com',
        port:   993,
        secure: true,
        auth:   { user: GMAIL_EMAIL, pass: GMAIL_PASSWORD },
        logger: false,
    });

    try {
        await imap.connect();
        const lock = await imap.getMailboxLock('INBOX');

        try {
            // Get UIDs of all unseen messages
            const uids = await imap.search({ seen: false }, { uid: true });

            if (!uids || uids.length === 0) {
                console.log('[EMAIL] No new emails.');
                return;
            }

            // On first run cap at last 5 to avoid flooding Bond's Cabin
            const toProcess = uids.slice(-5);
            console.log(`[EMAIL] ${uids.length} unread found. Processing ${toProcess.length}…`);

            // Use ImapFlow's built-in envelope + bodyText — more reliable than source+simpleParser
            for await (const msg of imap.fetch(toProcess, { envelope: true, bodyText: true }, { uid: true })) {
                try {
                    const env     = msg.envelope || {};
                    const subject = env.subject || '(No Subject)';
                    const fromObj = (env.from || [])[0] || {};
                    const from    = fromObj.name
                        ? `${fromObj.name} <${fromObj.address}>`
                        : (fromObj.address || 'Unknown');
                    const body    = truncate(msg.bodyText || '');
                    const date    = env.date
                        ? `<t:${Math.floor(new Date(env.date).getTime() / 1000)}:F>`
                        : 'Unknown';
                    const toAddr  = (env.to || [])[0]?.address || 'contact@nmc-logistics.xyz';

                    const embed = new EmbedBuilder()
                        .setColor(0xe8a020)
                        .setTitle(`📬 New Email — ${subject}`)
                        .setDescription(body)
                        .addFields(
                            { name: '👤 From',     value: from,    inline: true  },
                            { name: '📨 To',       value: toAddr,  inline: true  },
                            { name: '🕐 Received', value: date,    inline: false },
                        )
                        .setFooter({ text: 'contact@nmc-logistics.xyz • NMC Mail' })
                        .setTimestamp();

                    await cabin.send({ embeds: [embed] });
                    console.log(`[EMAIL] ✅ Posted: "${subject}" from ${from}`);

                } catch (msgErr) {
                    console.error(`[EMAIL] Error parsing UID ${msg.uid}:`, msgErr.message);
                }
            }

            // Mark ALL unseen (including skipped ones) as read so they don't
            // pile up and get re-processed every poll
            await imap.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
            console.log(`[EMAIL] Marked ${uids.length} message(s) as read.`);

        } finally {
            lock.release();
        }

        await imap.logout();

    } catch (err) {
        console.error('[EMAIL] IMAP error:', err.message);
        try { await imap.logout(); } catch { /* ignore */ }
    } finally {
        polling = false;
    }
}

// ── Starter ────────────────────────────────────────────────────
export function startEmailPoller(client) {
    if (!GMAIL_EMAIL || !GMAIL_PASSWORD) {
        console.warn('[EMAIL] Email poller disabled — GMAIL credentials not configured.');
        return;
    }

    console.log(`[EMAIL] Email poller started. Checking every 5 minutes.`);

    // Poll immediately on startup, then every 5 min
    pollInbox(client).catch(err => console.error('[EMAIL] Initial poll error:', err.message));
    setInterval(() => {
        pollInbox(client).catch(err => console.error('[EMAIL] Poll error:', err.message));
    }, POLL_INTERVAL_MS);
}
