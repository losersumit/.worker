/**
 * Communications Tools — Capability Module
 * Provides channel/role resolution, announcement previews, webhook sends,
 * and mid-task clarification for the agent loop.
 */

import { resolveChannel, resolveRole, resolvePingTarget } from '../resolvers.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import axios from 'axios';

// ─── Tool Definitions ───────────────────────────────────────────────

export const definitions = [
    {
        type: 'function',
        function: {
            name: 'get_all_channels',
            description: 'Get a list of all text channels in the Discord server (from cache, zero API cost).',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_all_roles',
            description: 'Get a list of all roles in the Discord server (from cache, zero API cost).',
            parameters: { type: 'object', properties: {}, required: [] },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_webhooks',
            description: 'Get available webhooks for a given channel. Provide the channel name or a hint to fuzzy-match it.',
            parameters: {
                type: 'object',
                properties: {
                    channel_hint: {
                        type: 'string',
                        description: 'Channel name or hint to find webhooks for.',
                    },
                },
                required: ['channel_hint'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'resolve_channel',
            description: 'Fuzzy-match a channel name hint to an actual Discord channel.',
            parameters: {
                type: 'object',
                properties: {
                    hint: {
                        type: 'string',
                        description: 'The channel name or close approximation (e.g. "bulletin", "generalzz").',
                    },
                },
                required: ['hint'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'resolve_ping_target',
            description: 'Convert a mention target text to a Discord mention string (e.g. "everyone" → @everyone, "operators" → role mention).',
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'The target to mention (e.g. "everyone", "here", "operators", "commander").',
                    },
                },
                required: ['text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ask_clarification',
            description:
                'Ask the user a clarifying question mid-task. Use when critical information is missing ' +
                '(e.g. which channel to post in, which user to target). Worker will pause and wait for their reply.',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The specific question to ask the user.',
                    },
                },
                required: ['question'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'preview_announcement',
            description:
                'Build a preview of an announcement embed and show it to the requester for confirmation ' +
                'before actually sending it. The user will see the preview with Confirm/Cancel buttons. ' +
                'ALWAYS use this before sending any announcement or embed to a public channel.',
            parameters: {
                type: 'object',
                properties: {
                    channel_hint: {
                        type: 'string',
                        description: 'Target channel name or hint where the announcement will be sent.',
                    },
                    title: {
                        type: 'string',
                        description: 'Title of the embed.',
                    },
                    description: {
                        type: 'string',
                        description: 'Body/description of the embed.',
                    },
                    color: {
                        type: 'string',
                        description: 'Hex color for the embed (e.g. "#B22222"). Optional.',
                    },
                    ping_target: {
                        type: 'string',
                        description: 'Who to ping (e.g. "everyone", "operators"). Optional.',
                    },
                    webhook_name: {
                        type: 'string',
                        description: 'Name of the webhook to send through (optional — if not specified, sends as the bot).',
                    },
                },
                required: ['channel_hint', 'title', 'description'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'send_via_webhook',
            description: 'Send an embed message through a specific webhook URL. Use for announcements that should appear with a custom name/avatar.',
            parameters: {
                type: 'object',
                properties: {
                    webhook_url: {
                        type: 'string',
                        description: 'The full webhook URL.',
                    },
                    title: {
                        type: 'string',
                        description: 'Embed title.',
                    },
                    description: {
                        type: 'string',
                        description: 'Embed body text.',
                    },
                    color: {
                        type: 'string',
                        description: 'Hex color (e.g. "#B22222"). Optional.',
                    },
                    buttons: {
                        type: 'string',
                        description: 'JSON array of buttons: [{"label":"Buy","customId":"shop_buy:item"}]. Optional.',
                    },
                },
                required: ['webhook_url', 'title', 'description'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'send_via_channel',
            description: 'Send an embed message directly to a Discord channel as the bot.',
            parameters: {
                type: 'object',
                properties: {
                    channel_id: {
                        type: 'string',
                        description: 'The target Discord channel ID.',
                    },
                    title: {
                        type: 'string',
                        description: 'Embed title.',
                    },
                    description: {
                        type: 'string',
                        description: 'Embed body text.',
                    },
                    color: {
                        type: 'string',
                        description: 'Hex color (e.g. "#00CC66"). Optional.',
                    },
                    ping_target: {
                        type: 'string',
                        description: 'Who to ping alongside the embed. Optional.',
                    },
                },
                required: ['channel_id', 'title', 'description'],
            },
        },
    },
];

// ─── Helpers ────────────────────────────────────────────────────────

function parseColor(hex) {
    if (!hex) return 0x0099ff;
    const cleaned = hex.replace('#', '');
    const num = parseInt(cleaned, 16);
    return isNaN(num) ? 0x0099ff : num;
}

// ─── Executor ───────────────────────────────────────────────────────

export async function execute(toolName, args, context) {
    const { client, guild, message, userId, channelId } = context;

    try {
        switch (toolName) {
            case 'get_all_channels': {
                if (!guild) return { error: 'No guild context.' };
                const channels = guild.channels.cache
                    .filter(ch => ch.isTextBased() && ch.name)
                    .map(ch => ({ id: ch.id, name: ch.name, type: ch.type }));
                return { channels };
            }

            case 'get_all_roles': {
                if (!guild) return { error: 'No guild context.' };
                const roles = guild.roles.cache
                    .filter(r => r.name !== '@everyone')
                    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
                    .sort((a, b) => b.position - a.position);
                return { roles };
            }

            case 'get_webhooks': {
                if (!guild) return { error: 'No guild context.' };
                const channel = resolveChannel(guild, args.channel_hint);
                if (!channel || channel.ambiguous) {
                    return {
                        error: channel?.ambiguous
                            ? `Ambiguous channel match. Candidates: ${channel.candidates.map(c => c.name).join(', ')}`
                            : 'Channel not found.',
                    };
                }
                try {
                    const webhooks = await channel.fetchWebhooks();
                    return {
                        channel: channel.name,
                        webhooks: webhooks.map(w => ({ id: w.id, name: w.name, url: w.url })),
                    };
                } catch (err) {
                    return { error: `Could not fetch webhooks: ${err.message}` };
                }
            }

            case 'resolve_channel': {
                if (!guild) return { error: 'No guild context.' };
                const channel = resolveChannel(guild, args.hint);
                if (!channel) return { found: false, message: 'No matching channel found.' };
                if (channel.ambiguous) {
                    return {
                        found: false,
                        ambiguous: true,
                        candidates: channel.candidates.map(c => ({ id: c.id, name: c.name })),
                    };
                }
                return { found: true, id: channel.id, name: channel.name };
            }

            case 'resolve_ping_target': {
                if (!guild) return { error: 'No guild context.' };
                const mention = resolvePingTarget(guild, args.text);
                if (!mention) return { resolved: false, message: `Could not resolve "${args.text}" to a pingable target.` };
                return { resolved: true, mention };
            }

            case 'ask_clarification': {
                // Signal the agent loop to pause and ask the user
                return { __action: 'clarification', question: args.question };
            }

            case 'preview_announcement': {
                if (!guild) return { error: 'No guild context.' };

                // Resolve the target channel
                const channel = resolveChannel(guild, args.channel_hint);
                if (!channel || channel.ambiguous) {
                    return {
                        __action: 'clarification',
                        question: channel?.ambiguous
                            ? `Which channel did you mean? Options: ${channel.candidates.map(c => c.name).join(', ')}`
                            : `I couldn't find a channel matching "${args.channel_hint}". Which channel should I use?`,
                    };
                }

                // Resolve ping target if provided
                let pingMention = null;
                if (args.ping_target) {
                    pingMention = resolvePingTarget(guild, args.ping_target);
                }

                // Build the embed data
                const embedData = {
                    title: args.title,
                    description: args.description,
                    color: parseColor(args.color),
                };

                return {
                    __action: 'preview',
                    embedData,
                    targetChannelId: channel.id,
                    channelName: channel.name,
                    pingMention,
                    webhookName: args.webhook_name || null,
                };
            }

            case 'send_via_webhook': {
                const embed = {
                    title: args.title,
                    description: args.description,
                    color: parseColor(args.color),
                };

                const webhookPayload = { embeds: [embed] };

                // Parse and add buttons if provided
                if (args.buttons) {
                    try {
                        const buttons = JSON.parse(args.buttons);
                        if (Array.isArray(buttons) && buttons.length > 0) {
                            const components = buttons.map(btn => ({
                                type: 2, // Button
                                style: 1, // Primary
                                label: btn.label,
                                custom_id: btn.customId,
                            }));
                            webhookPayload.components = [{ type: 1, components }];
                        }
                    } catch {
                        // Ignore button parse errors
                    }
                }

                await axios.post(args.webhook_url, webhookPayload, {
                    headers: { 'Content-Type': 'application/json' },
                });

                return { sent: true, via: 'webhook' };
            }

            case 'send_via_channel': {
                const targetChannel = await client.channels.fetch(args.channel_id).catch(() => null);
                if (!targetChannel) return { error: 'Channel not found.' };

                const embed = new EmbedBuilder()
                    .setTitle(args.title)
                    .setDescription(args.description)
                    .setColor(parseColor(args.color));

                const sendPayload = { embeds: [embed] };

                if (args.ping_target && guild) {
                    const mention = resolvePingTarget(guild, args.ping_target);
                    if (mention) sendPayload.content = mention;
                }

                await targetChannel.send(sendPayload);
                return { sent: true, via: 'channel', channelName: targetChannel.name };
            }

            default:
                return { error: `Unknown comms tool: ${toolName}` };
        }
    } catch (err) {
        console.error(`[commsTools] ${toolName} error:`, err.message);
        return { error: `Comms tool failed: ${err.message}` };
    }
}
