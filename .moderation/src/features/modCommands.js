import { EmbedBuilder, PermissionsBitField, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { getUserWarnings, resetWarnings, killUser, unkillUser } from '../systems/storage.js';
import { handleTodoCommand } from './todoCommands.js';
import { supabase } from '../clients/supabase.js';
import { groqChatCompletion } from '../clients/groq.js';


const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID;
const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const VISITOR_ROLE_ID = process.env.VISITOR_ROLE_ID;
const ENLISTED_ROLE_ID = process.env.ENLISTED_ROLE_ID;

// Discord max timeout: 28 days in milliseconds
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * Parse a duration string like "30m", "2h", "7d" into milliseconds.
 */
function parseDuration(str) {
    if (!str) return null;
    const match = str.match(/^(\d+)\s*(m|h|d)$/i);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

/**
 * Format milliseconds into a human-readable duration string.
 */
function formatDuration(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ') || '0m';
}

/**
 * Resolve a target GuildMember from mention, user ID, or username.
 */
async function resolveTarget(message, targetArg) {
    if (!targetArg) return null;

    // Check for mention
    const mentioned = message.mentions.members?.first();
    if (mentioned) return mentioned;

    // Try as raw user ID
    const userId = targetArg.replace(/[^0-9]/g, '');
    if (userId && userId.length >= 17) {
        try {
            return await message.guild.members.fetch(userId);
        } catch { /* not in server */ }
    }

    // Try as username search
    try {
        const members = await message.guild.members.fetch({ query: targetArg, limit: 1 });
        if (members.size > 0) return members.first();
    } catch { /* ignore */ }

    return null;
}

/**
 * Resolve a user (not necessarily in guild) for ban/unban.
 * Returns { user, member? } — member may be null for non-server users.
 */
async function resolveUserForBan(message, targetArg, client) {
    if (!targetArg) return null;

    // Check mention first
    const mentioned = message.mentions.members?.first();
    if (mentioned) return { user: mentioned.user, member: mentioned };

    // Try as user ID
    const userId = targetArg.replace(/[^0-9]/g, '');
    if (userId && userId.length >= 17) {
        // Try guild member first
        try {
            const member = await message.guild.members.fetch(userId);
            return { user: member.user, member };
        } catch { /* not in server */ }

        // Try fetching user directly (not in server)
        try {
            const user = await client.users.fetch(userId);
            return { user, member: null };
        } catch { /* invalid ID */ }
    }

    // Try as username search in guild
    try {
        const members = await message.guild.members.fetch({ query: targetArg, limit: 1 });
        if (members.size > 0) {
            const member = members.first();
            return { user: member.user, member };
        }
    } catch { /* ignore */ }

    return null;
}

/**
 * Check if the message author has permission to use moderation commands.
 */
function hasModPermission(message) {
    const member = message.member;
    if (!member) return false;

    if (COMMANDER_ROLE_ID && member.roles.cache.has(COMMANDER_ROLE_ID)) return true;
    if (PARTNER_ROLE_ID && member.roles.cache.has(PARTNER_ROLE_ID)) return true;

    return false;
}

/**
 * Log a moderation action to the log channel.
 */
async function logModAction(client, guild, action, moderator, target, details) {
    if (!LOG_CHANNEL_ID) return;

    try {
        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (!logChannel) return;

        const targetStr = target.tag || target.user?.tag || `${target}`;
        const targetId = target.id || target.user?.id || target;

        const embed = new EmbedBuilder()
            .setColor(action === 'unmute' || action === 'unban' || action === 'unlock' ? 0x2ECC71 : 0xE74C3C)
            .setTitle(`🛡️ Moderation Action: ${action.toUpperCase()}`)
            .addFields(
                { name: 'Moderator', value: `${moderator} (${moderator.id})`, inline: true },
                { name: 'Target', value: `${targetStr} (${targetId})`, inline: true },
                { name: 'Details', value: details || 'No details', inline: false }
            )
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[MOD-LOG] Failed to log action:', err.message);
    }
}

// ─── Command Handlers ───────────────────────────────────────────────────

async function handleMute(message, args, client) {
    const targetArg = args[0];
    const durationArg = args[1];

    const target = await resolveTarget(message, targetArg);
    if (!target) return message.reply('❌ Could not find that user. Use a mention, user ID, or username.');

    if (!target.moderatable) {
        return message.reply('❌ I cannot timeout this user. Check my role hierarchy.');
    }

    let durationMs = MAX_TIMEOUT_MS;
    if (durationArg) {
        const parsed = parseDuration(durationArg);
        if (!parsed) {
            return message.reply('❌ Invalid duration. Use `<number>m`, `<number>h`, or `<number>d`. Example: `5m`, `2h`, `7d`');
        }
        durationMs = Math.min(parsed, MAX_TIMEOUT_MS);
    }

    try {
        await target.timeout(durationMs, `Muted by ${message.author.tag}`);
        const durationStr = formatDuration(durationMs);

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setDescription(`🔇 **${target.displayName}** has been muted for **${durationStr}**.`)
            .setFooter({ text: `By ${message.member.displayName}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        await logModAction(client, message.guild, 'mute', message.author, target, `Duration: ${durationStr}`);
    } catch (err) {
        console.error('[MOD] Mute error:', err);
        message.reply(`❌ Failed to mute: ${err.message}`);
    }
}

async function handleUnmute(message, args, client) {
    const targetArg = args[0];

    const target = await resolveTarget(message, targetArg);
    if (!target) return message.reply('❌ Could not find that user. Use a mention, user ID, or username.');

    try {
        await target.timeout(null, `Unmuted by ${message.author.tag}`);

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setDescription(`🔊 **${target.displayName}** has been unmuted.`)
            .setFooter({ text: `By ${message.member.displayName}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        await logModAction(client, message.guild, 'unmute', message.author, target, 'Timeout removed');
    } catch (err) {
        console.error('[MOD] Unmute error:', err);
        message.reply(`❌ Failed to unmute: ${err.message}`);
    }
}

async function handleMurder(message, args, client) {
    const targetArg = args[0];
    const reason = args.slice(1).join(' ') || `Murdered by ${message.author.tag}`;

    const resolved = await resolveUserForBan(message, targetArg, client);
    if (!resolved) return message.reply('❌ Could not find that user. Use a mention, user ID, or username.');

    const { user, member } = resolved;

    // If in the guild, check role hierarchy
    if (member && member.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
        return message.reply('❌ I cannot murder this user. Check role hierarchy.');
    }

    try {
        if (member) {
            // Strip all roles
            await member.roles.set([]).catch(err => console.error('Failed to strip roles:', err));
        }

        await killUser(user.id, user.tag);

        // Fetch last 20 choices to avoid duplicates
        let lastChoices = [];
        try {
            const { data } = await supabase
                .from('murder_choices')
                .select('choice')
                .order('id', { ascending: false })
                .limit(20);
            if (data) {
                lastChoices = data.map(r => r.choice);
            }
        } catch (dbErr) {
            console.warn('[Murder] Could not fetch last choices (table might not exist):', dbErr.message);
        }

        const murdererName = message.member?.displayName || message.author.globalName || message.author.username;
        const victimName = member?.displayName || user.globalName || user.username;

        // Generate murder scenario
        let murderScenario = `${victimName} was murdered by ${murdererName}.`;
        try {
            const avoidedList = lastChoices.length > 0
                ? `Avoid using or repeating any of these recent murder methods:\n${lastChoices.map((c, i) => `- ${c}`).join('\n')}`
                : '';

            const prompt = `You are a dark-humor writer. Write a highly creative, extremely unrealistic, crazy, and funny murder description sentence.
The murderer/killer is: "${murdererName}"
The victim is: "${victimName}"

Requirements:
- Make it extremely unrealistic, crazy, and absurd, but possible (do not use fantasy/magic/dragons/sci-fi tech; it must be possible in the physical world but a totally crazy/absurd thing to do).
- It must be humoristic and not feel realistic.
- You can use any type of weapon or death type (especially vulgar, absurd, or high-destruction ones).
- Examples: 
  - "${victimName} died while taking 4 at a time in anal"
  - "${murdererName} bombed ${victimName} with a nuclear bomb"
- Incorporate both the killer (${murdererName}) and the victim (${victimName}) naturally in the description.
- ${avoidedList}
- Return ONLY the final murder description sentence. Do not include any quotes, markdown formatting, explanations, or preamble. Keep it concise (one sentence).`;

            const aiResponse = await groqChatCompletion({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }]
            });

            if (aiResponse?.choices?.[0]?.message?.content) {
                murderScenario = aiResponse.choices[0].message.content.trim().replace(/["']/g, '');
            }
        } catch (aiErr) {
            console.error('[Murder] AI generation failed:', aiErr);
        }

        // Save selection to DB
        try {
            await supabase
                .from('murder_choices')
                .insert({ choice: murderScenario });
        } catch (dbErr) {
            console.warn('[Murder] Could not save choice to DB:', dbErr.message);
        }

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setDescription(`💀 ${murderScenario}`)
            .addFields({ name: 'Reason', value: reason })
            .setFooter({ text: `Murder Request Complete` })
            .setTimestamp();

        const button = new ButtonBuilder()
            .setCustomId(`know_more_gun:${murderScenario.slice(0, 80)}`)
            .setLabel(`Explain this murder method`)
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        await message.reply({ embeds: [embed], components: [row] });
        await logModAction(client, message.guild, 'murder', message.author, user, `Reason: ${reason} (Method: ${murderScenario})`);
    } catch (err) {
        console.error('[MOD] Murder error:', err);
        message.reply(`❌ Failed to murder: ${err.message}`);
    }
}

async function handleRevive(message, args, client) {
    const targetArg = args[0];
    if (!targetArg) return message.reply('❌ Please provide a user ID, mention, or username to revive.');

    let discordId = null;
    let user = null;
    let member = null;

    // Try direct ID or mention first
    const rawId = targetArg.replace(/[^0-9]/g, '');
    if (rawId && rawId.length >= 17) {
        member = await message.guild.members.fetch(rawId).catch(() => null);
        if (member) {
            user = member.user;
            discordId = user.id;
        } else {
            user = await client.users.fetch(rawId).catch(() => null);
            if (user) discordId = user.id;
        }
    }

    // Fallback: search killed_users table by username
    if (!discordId) {
        const { data: rows } = await supabase
            .from('killed_users')
            .select('discord_id, username')
            .eq('status', 'killed');

        if (rows && rows.length > 0) {
            const match = rows.find(r =>
                r.username?.toLowerCase() === targetArg.toLowerCase() ||
                r.discord_id === targetArg
            );
            if (match) {
                discordId = match.discord_id;
                member = await message.guild.members.fetch(discordId).catch(() => null);
                if (member) user = member.user;
                else user = await client.users.fetch(discordId).catch(() => null);
            }
        }
    }

    if (!discordId) {
        return message.reply('❌ Could not find a killed user matching that ID or username.');
    }

    try {
        await unkillUser(discordId);

        // If the user is in the server, give them the Visitor role
        let roleMsg = '';
        if (member) {
            const visitorRoleId = process.env.VISITOR_ROLE_ID || process.env.AUTO_ROLE_ID;
            if (visitorRoleId) {
                const role = message.guild.roles.cache.get(visitorRoleId);
                if (role) {
                    await member.roles.add(role);
                    roleMsg = ' (Visitor role restored)';
                } else {
                    roleMsg = ' (⚠️ Visitor role configured but not found in server)';
                }
            } else {
                roleMsg = ' (⚠️ Visitor role ID not configured)';
            }
        }

        const tag = user ? user.tag : discordId;
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setDescription(`✅ **${tag}** has been revived. Their status is now **alive**${roleMsg}.`)
            .setFooter({ text: `By ${message.member.displayName}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        await logModAction(client, message.guild, 'revive', message.author, user || { tag: discordId, id: discordId }, `User revived${roleMsg}`);
    } catch (err) {
        console.error('[MOD] Revive error:', err);
        message.reply(`❌ Failed to revive: ${err.message}`);
    }
}

async function handleKick(message, args, client) {
    const targetArg = args[0];
    const reason = args.slice(1).join(' ') || `Kicked by ${message.author.tag}`;

    const target = await resolveTarget(message, targetArg);
    if (!target) return message.reply('❌ Could not find that user. Use a mention, user ID, or username.');

    if (!target.kickable) {
        return message.reply('❌ I cannot kick this user. Check my role hierarchy.');
    }

    try {
        await target.kick(reason);

        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setDescription(`👢 **${target.user.tag}** has been kicked.`)
            .addFields({ name: 'Reason', value: reason })
            .setFooter({ text: `By ${message.member.displayName}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        await logModAction(client, message.guild, 'kick', message.author, target, `Reason: ${reason}`);
    } catch (err) {
        console.error('[MOD] Kick error:', err);
        message.reply(`❌ Failed to kick: ${err.message}`);
    }
}

async function handleLock(message, args, client) {
    const targetArg = args[0];
    // Default to the current channel if none specified
    const channel = targetArg
        ? await resolveChannel(message, targetArg, client)
        : message.channel;
    if (!channel) return message.reply('❌ Could not find that channel.');

    const rolesToLock = [VISITOR_ROLE_ID, ENLISTED_ROLE_ID].filter(Boolean);
    if (rolesToLock.length === 0) return message.reply('❌ VISITOR_ROLE_ID or ENLISTED_ROLE_ID not configured.');

    try {
        for (const roleId of rolesToLock) {
            await channel.permissionOverwrites.edit(roleId, {
                SendMessages: false,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setDescription(`🔒 **${channel}** has been locked.`)
            .setFooter({ text: `By ${message.member.displayName}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        await logModAction(client, message.guild, 'lock', message.author, { tag: channel.name, id: channel.id }, `Channel locked`);
    } catch (err) {
        console.error('[MOD] Lock error:', err);
        message.reply(`❌ Failed to lock: ${err.message}`);
    }
}

async function handleUnlock(message, args, client) {
    const targetArg = args[0];
    // Default to the current channel if none specified
    const channel = targetArg
        ? await resolveChannel(message, targetArg, client)
        : message.channel;
    if (!channel) return message.reply('❌ Could not find that channel.');

    const rolesToUnlock = [VISITOR_ROLE_ID, ENLISTED_ROLE_ID].filter(Boolean);
    if (rolesToUnlock.length === 0) return message.reply('❌ VISITOR_ROLE_ID or ENLISTED_ROLE_ID not configured.');

    try {
        for (const roleId of rolesToUnlock) {
            await channel.permissionOverwrites.edit(roleId, {
                SendMessages: null,  // reset to default (inherit)
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setDescription(`🔓 **${channel}** has been unlocked.`)
            .setFooter({ text: `By ${message.member.displayName}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        await logModAction(client, message.guild, 'unlock', message.author, { tag: channel.name, id: channel.id }, `Channel unlocked`);
    } catch (err) {
        console.error('[MOD] Unlock error:', err);
        message.reply(`❌ Failed to unlock: ${err.message}`);
    }
}

async function handlePurge(message, args, client) {
    const count = parseInt(args[0]);
    if (isNaN(count) || count < 1 || count > 100) {
        return message.reply('❌ Usage: `!purge <1-100>`');
    }

    try {
        // Delete the command message first
        await message.delete().catch(() => {});
        const deleted = await message.channel.bulkDelete(count, true);
        const reply = await message.channel.send(`🧹 Purged **${deleted.size}** messages.`);
        setTimeout(() => reply.delete().catch(() => {}), 3000);
    } catch (err) {
        console.error('[MOD] Purge error:', err);
        message.channel.send(`❌ Failed to purge: ${err.message}`).catch(() => {});
    }
}

// Helper function to format dates
function formatDate(dateString) {
    const date = new Date(dateString);
    return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

// Helper function to format action types
function formatActionType(actionType) {
    switch (actionType) {
        case 'timeout_1h': return 'Timeout (1 hour)';
        case 'timeout_24h': return 'Timeout (24 hours)';
        case 'kick': return 'Kick';
        case 'ban': return 'Ban';
        default: return actionType;
    }
}

async function handleWrns(message, args, client) {
    const targetArg = args[0];
    if (!targetArg) return message.reply('❌ Usage: `!warns <@user|ID|username>`');

    const target = await resolveTarget(message, targetArg);
    if (!target) return message.reply('❌ Could not find that user.');

    const warnings = await getUserWarnings(target.id);

    if (!warnings || warnings.count === 0) {
        return message.reply(`✅ **${target.user.tag}** has no warnings.`);
    }

    const embed = new EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle(`Warning History for ${target.user.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
            { name: 'Total Warnings', value: `${warnings.count}`, inline: true },
            { name: 'Last Warning', value: warnings.lastWarning ? formatDate(warnings.lastWarning) : 'N/A', inline: true }
        )
        .setFooter({ text: 'NMC Moderation System' })
        .setTimestamp();

    if (warnings.warnings && warnings.warnings.length > 0) {
        const recentWarnings = warnings.warnings.slice(0, 10);
        let warningsText = '';
        recentWarnings.forEach((warning, index) => {
            warningsText += `**${index + 1}.** ${formatDate(warning.timestamp)}\n`;
            warningsText += `⟶ Reason: ${warning.reason}\n`;
            warningsText += `⟶ Severity: ${warning.severity}\n\n`;
        });
        embed.addFields({ name: 'Recent Warnings', value: warningsText });
    }

    if (warnings.actionsTaken && warnings.actionsTaken.length > 0) {
        let actionsText = '';
        warnings.actionsTaken.forEach((action, index) => {
            actionsText += `**${index + 1}.** ${formatActionType(action.type)} - ${formatDate(action.timestamp)}\n`;
        });
        embed.addFields({ name: 'Actions Taken', value: actionsText });
    }

    await message.reply({ embeds: [embed] });
}

async function handleClrWrns(message, args, client) {
    const targetArg = args[0];
    if (!targetArg) return message.reply('❌ Usage: `!cw <@user|ID|username>`');

    const target = await resolveTarget(message, targetArg);
    if (!target) return message.reply('❌ Could not find that user.');

    const warnings = await getUserWarnings(target.id);

    if (!warnings || warnings.count === 0) {
        return message.reply(`✅ **${target.user.tag}** has no warnings to clear.`);
    }

    await resetWarnings(target.id, { logging: { consoleLog: true } });
    await message.reply(`✅ Cleared all warnings for **${target.user.tag}**.`);
    await logModAction(client, message.guild, 'unmute', message.author, target, 'Warnings cleared');
}

async function handleModHelp(message, args, client) {
    const embed = new EmbedBuilder()
        .setColor(0x2F3136)
        .setTitle('🛡️ Moderation Commands')
        .setDescription('All moderation commands for Commander and Partner roles.')
        .addFields(
            {
                name: '⚡ Prefix Commands (`!`)',
                value:
                    '`!mute <@user|ID|username> [duration]`\nTimeout a user. No duration = 28 days.\n' +
                    '`!unmute <@user|ID|username>`\nRemove timeout from a user.\n' +
                    '`!murder <@user|ID|username> [reason]`\nMurder a user (strips all roles and restricts autorole).\n' +
                    '`!revive <ID|username>`\nRevive a user (restores autorole capability and Visitor role).\n' +
                    '`!kick <@user|ID|username> [reason]`\nKick a user from the server.\n' +
                    '`!lock [#channel|ID|link]`\nLock a channel. Defaults to current channel if none given.\n' +
                    '`!unlock [#channel|ID|link]`\nUnlock a channel. Defaults to current channel if none given.\n' +
                    '`!purge <1-100>`\nBulk delete messages in the current channel.\n' +
                    '`!warns <@user|ID|username>`\nView warnings for a user.\n' +
                    '`!cw <@user|ID|username>`\nClear all warnings for a user.\n' +
                    '`!restart`\nRestart the bot container (crashing it so Railway boots it back up).\n' +
                    '`!modhelp`\nShow this help page.',
                inline: false
            },
            {
                name: '🔧 Slash Commands (`/`)',
                value:
                    '`/adddriver`\nAdd an NMC Officer or Driver to the website.\n' +
                    '`/addmedia`\nAdd a photo or video to the NMC website media gallery.\n' +
                    '`/addpartner`\nAdd a partner server to the NMC website.\n' +
                    '`/enlist`\nEnlist a player with a number and optional officer role.\n' +
                    '`/sendstylingembed`\nPost a styled embed with a custom color analyzed from the attached image.\n' +
                    '`/setwh`\nGet or Create a Webhook.',
                inline: false
            },
            {
                name: '⏱️ Duration Format',
                value: '`Nm` = minutes, `Nh` = hours, `Nd` = days\nExamples: `30m`, `2h`, `7d`',
                inline: false
            }
        )
        .setFooter({ text: 'NMC Moderation System' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
}

async function handleRestart(message, args, client) {
    // React with custom emoji
    await message.react('1460635571151179868').catch(err => {
        console.error('Failed to react with custom emoji:', err);
        return message.react('✅');
    }).catch(() => {});

    await logModAction(client, message.guild, 'restart', message.author, 'System', 'Manual container restart initiated.');

    setTimeout(() => {
        console.log(`⚠️ Process exit triggered by restart command from ${message.author.tag}`);
        process.exit(1);
    }, 1000);
}

/**
 * Resolve a channel from a mention (#channel), channel ID, or Discord channel link.
 */
async function resolveChannel(message, input, client) {
    // Channel mention: <#123456789>
    const mentionMatch = input.match(/^<#(\d+)>$/);
    if (mentionMatch) {
        try { return await client.channels.fetch(mentionMatch[1]); } catch { return null; }
    }

    // Channel link: https://discord.com/channels/guildId/channelId
    const linkMatch = input.match(/channels\/\d+\/(\d+)/);
    if (linkMatch) {
        try { return await client.channels.fetch(linkMatch[1]); } catch { return null; }
    }

    // Raw channel ID
    const idMatch = input.match(/^(\d{17,})$/);
    if (idMatch) {
        try { return await client.channels.fetch(idMatch[1]); } catch { return null; }
    }

    return null;
}

// ─── Router ─────────────────────────────────────────────────────────────

const MOD_COMMANDS = {
    mute: handleMute,
    unmute: handleUnmute,
    murder: handleMurder,
    revive: handleRevive,
    kick: handleKick,
    lock: handleLock,
    unlock: handleUnlock,
    purge: handlePurge,
    modhelp: handleModHelp,
    warns: handleWrns,
    cw: handleClrWrns,
    restart: handleRestart,
    todo: handleTodoCommand,
};

/**
 * Handle `!` prefix moderation commands.
 * @returns {boolean} true if a command was handled, false otherwise
 */
export async function handleModCommand(message, client) {
    const args = message.content.slice(1).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();

    const handler = MOD_COMMANDS[commandName];
    if (!handler) return false;

    // Permission check (Bypassed for 'todo' as it handles its own internal permissions per subcommand)
    if (commandName !== 'todo' && !hasModPermission(message)) {
        await message.reply('❌ You do not have permission to use moderation commands.');
        return true;
    }

    if (args.length < 1 && !['modhelp', 'purge', 'restart', 'todo', 'lock', 'unlock'].includes(commandName)) {
        const usages = {
            mute: '`!mute <@user|ID|username> [duration]`',
            unmute: '`!unmute <@user|ID|username>`',
            murder: '`!murder <@user|ID|username> [reason]`',
            revive: '`!revive <ID|username>`',
            kick: '`!kick <@user|ID|username> [reason]`',
            warns: '`!warns <@user|ID|username>`',
            cw: '`!cw <@user|ID|username>`',
            restart: '`!restart`',
        };
        await message.reply(`Usage: ${usages[commandName]}`);
        return true;
    }

    try {
        await handler(message, args, client);
    } catch (err) {
        console.error(`[MOD] Error executing !${commandName}:`, err);
        await message.reply('❌ An error occurred while executing the command.');
    }

    return true;
}
