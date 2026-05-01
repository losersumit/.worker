/**
 * emailPoller.js
 * ─────────────────────────────────────────────────────────────
 * Polls Gmail IMAP every 5 minutes, posts new emails to Bond's
 * Cabin with full body text + attachments (up to 25 MB each).
 * ─────────────────────────────────────────────────────────────
 */

import { ImapFlow }          from 'imapflow';
import { simpleParser }      from 'mailparser';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';

const POLL_INTERVAL_MS  = 5 * 60 * 1000; // 5 minutes
const DISCORD_MAX_BYTES = 24 * 1024 * 1024; // 24 MB safety margin

const GMAIL_EMAIL    = process.env.GMAIL_EMAIL;
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const CABIN_ID       = process.env.MAIL_CHANNEL_ID;

let polling = false;

// ── Helpers ────────────────────────────────────────────────────
function truncate(str, max = 4000) {
    if (!str) return '*No content*';
    const clean = str.replace(/\r?\n{3,}/g, '\n\n').trim();
    return clean.length > max ? clean.slice(0, max - 3) + '…' : clean;
}

function htmlToText(html) {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\r?\n{3,}/g, '\n\n')
        .trim();
}

// ── Core poll ─────────────────────────────────────────────────
async function pollInbox(discordClient) {
    if (!GMAIL_EMAIL || !GMAIL_PASSWORD) return;
    if (!CABIN_ID) return;
    if (polling) return;
    polling = true;

    const cabin = await discordClient.channels.fetch(CABIN_ID).catch(() => null);
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
            const uids = await imap.search({ seen: false }, { uid: true });

            if (!uids || uids.length === 0) {
                console.log('[EMAIL] No new emails.');
                return;
            }

            console.log(`[EMAIL] ${uids.length} unread email(s) found. Processing…`);

            // Fetch full source (needed for body + attachments)
            for await (const msg of imap.fetch(uids, { source: true }, { uid: true })) {
                try {
                    const parsed = await simpleParser(msg.source);

                    // ── Body text ────────────────────────────────
                    let body = '';
                    if (parsed.text) {
                        body = parsed.text;
                    } else if (parsed.html) {
                        body = htmlToText(parsed.html);
                    }
                    body = truncate(body);

                    // ── Sender / meta ────────────────────────────
                    const fromVal = parsed.from?.value?.[0] || {};
                    const from    = fromVal.name
                        ? `${fromVal.name} <${fromVal.address}>`
                        : (fromVal.address || 'Unknown');
                    const subject = parsed.subject || '(No Subject)';
                    const toAddr  = parsed.to?.text || 'contact@nmc-logistics.xyz';
                    const date    = parsed.date
                        ? `<t:${Math.floor(parsed.date.getTime() / 1000)}:F>`
                        : 'Unknown';

                    // ── Build embed ──────────────────────────────
                    const embed = new EmbedBuilder()
                        .setColor(0xe8a020)
                        .setTitle(`📬 ${subject}`)
                        .setDescription(body)
                        .addFields(
                            { name: '👤 From',     value: from,    inline: true  },
                            { name: '📨 To',       value: toAddr,  inline: true  },
                            { name: '🕐 Received', value: date,    inline: false },
                        )
                        .setFooter({ text: 'contact@nmc-logistics.xyz • NMC Mail' })
                        .setTimestamp();

                    // ── Attachments ──────────────────────────────
                    const files = [];
                    const skipped = [];

                    for (const att of (parsed.attachments || [])) {
                        if (!att.content) continue;
                        if (att.content.length > DISCORD_MAX_BYTES) {
                            skipped.push(`${att.filename} (${(att.content.length / 1024 / 1024).toFixed(1)} MB — too large)`);
                            continue;
                        }
                        files.push(
                            new AttachmentBuilder(att.content, { name: att.filename || 'attachment' })
                        );
                    }

                    if (skipped.length > 0) {
                        embed.addFields({
                            name: '⚠️ Skipped (>24 MB)',
                            value: skipped.join('\n'),
                            inline: false
                        });
                    }

                    if (files.length > 0) {
                        embed.addFields({
                            name: `📎 Attachments (${files.length})`,
                            value: files.map(f => `• ${f.name}`).join('\n'),
                            inline: false
                        });
                    }

                    // ── Send to Discord ──────────────────────────
                    // Discord allows max 10 files per message
                    const fileChunks = [];
                    for (let i = 0; i < files.length; i += 10) {
                        fileChunks.push(files.slice(i, i + 10));
                    }

                    // First message: embed + first batch of files
                    await cabin.send({ embeds: [embed], files: fileChunks[0] || [] });

                    // Overflow file chunks (if >10 attachments)
                    for (let i = 1; i < fileChunks.length; i++) {
                        await cabin.send({ content: `📎 More attachments from "${subject}":`, files: fileChunks[i] });
                    }

                    console.log(`[EMAIL] ✅ Posted: "${subject}" from ${from} | Attachments: ${files.length}`);

                } catch (msgErr) {
                    console.error(`[EMAIL] Error processing UID ${msg.uid}:`, msgErr.message);
                }
            }

            // Mark all as read
            await imap.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
            console.log(`[EMAIL] Marked ${uids.length} email(s) as read.`);

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
export function startEmailPoller(discordClient) {
    if (!GMAIL_EMAIL || !GMAIL_PASSWORD) {
        console.warn('[EMAIL] Email poller disabled — GMAIL credentials not configured.');
        return;
    }

    console.log('[EMAIL] Email poller started. Checking every 5 minutes.');

    pollInbox(discordClient).catch(err => console.error('[EMAIL] Initial poll error:', err.message));
    setInterval(() => {
        pollInbox(discordClient).catch(err => console.error('[EMAIL] Poll error:', err.message));
    }, POLL_INTERVAL_MS);
}
