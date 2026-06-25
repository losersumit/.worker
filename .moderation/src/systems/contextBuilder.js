/**
 * Context Builder
 * Assembles a lightweight context packet from a Discord message for the
 * agent processing loop. Reads exclusively from Discord's cache — no
 * API calls are made, so this stays fast even under heavy traffic.
 */

// ─── Inline text sanitiser ─────────────────────────────────────────

const MAX_CONTENT_LENGTH = 2000;

/**
 * Strip control characters, excessive whitespace, and truncate.
 * @param {string} raw
 * @returns {string}
 */
function sanitiseText(raw) {
  if (!raw) return '';
  return raw
    // Remove zero-width and control chars (keep newlines / tabs)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .slice(0, MAX_CONTENT_LENGTH);
}

/**
 * Remove the bot's own mention from message content so the agent
 * doesn't see "<@BOT_ID>" cluttering the user's actual text.
 * @param {string} content
 * @param {string} botId
 * @returns {string}
 */
function stripBotMention(content, botId) {
  if (!botId) return content;
  // Matches both <@ID> and <@!ID> forms
  const mentionRegex = new RegExp(`<@!?${botId}>`, 'g');
  return content.replace(mentionRegex, '').trim();
}

// ─── Role-based env IDs ─────────────────────────────────────────────

const COMMANDER_ROLE_ID = process.env.COMMANDER_ROLE_ID || '';
const PARTNER_ROLE_ID = process.env.PARTNER_ROLE_ID || '';

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Build a context packet from a Discord message.
 *
 * @param {import('discord.js').Message} message - The incoming Discord message
 * @param {import('discord.js').Client} client - The bot's Client instance
 * @returns {{
 *   userId: string,
 *   username: string,
 *   userRoles: string[],
 *   userRoleIds: string[],
 *   channelId: string,
 *   channelName: string,
 *   guildId: string|null,
 *   isReply: boolean,
 *   referencedMessage: { authorId: string, authorName: string, content: string }|null,
 *   hasImage: boolean,
 *   imageUrl: string|null,
 *   content: string,
 *   isCommander: boolean,
 *   isPartner: boolean,
 * }}
 */
export function buildContextPacket(message, client) {
  const { author, member, channel, guild } = message;

  // --- Display name resolution (cache-only, no API call) ---
  const username = member?.displayName
    || author?.globalName
    || author?.username
    || 'Unknown';

  // --- Roles (excluding @everyone) ---
  const roles = member?.roles?.cache?.filter(r => r.name !== '@everyone') ?? new Map();
  const userRoles = [...roles.values()].map(r => r.name);
  const userRoleIds = [...roles.values()].map(r => r.id);

  // --- Reply detection ---
  const isReply = Boolean(message.reference?.messageId);
  let referencedMessage = null;

  if (isReply && message.reference) {
    // message.channel.messages.cache may contain the referenced message
    const ref = channel.messages?.cache?.get(message.reference.messageId);
    if (ref) {
      referencedMessage = {
        authorId: ref.author?.id ?? '',
        authorName: ref.member?.displayName || ref.author?.globalName || ref.author?.username || 'Unknown',
        content: sanitiseText(ref.content),
      };
    }
  }

  // --- Image detection (first attachment or first embed image) ---
  const imageAttachment = message.attachments?.find(a =>
    a.contentType?.startsWith('image/'),
  );
  const embedImage = !imageAttachment
    ? message.embeds?.find(e => e.image?.url || e.thumbnail?.url)
    : null;

  const imageUrl = imageAttachment?.url
    || embedImage?.image?.url
    || embedImage?.thumbnail?.url
    || null;
  const hasImage = Boolean(imageUrl);

  // --- Sanitised content (bot mention stripped) ---
  const botId = client?.user?.id || '';
  const content = sanitiseText(stripBotMention(message.content || '', botId));

  // --- Role-based permission flags ---
  const isCommander = Boolean(COMMANDER_ROLE_ID && userRoleIds.includes(COMMANDER_ROLE_ID));
  const isPartner = Boolean(PARTNER_ROLE_ID && userRoleIds.includes(PARTNER_ROLE_ID));

  return {
    userId: author?.id ?? '',
    username,
    userRoles,
    userRoleIds,
    channelId: channel?.id ?? '',
    channelName: channel?.name ?? '',
    guildId: guild?.id ?? null,
    isReply,
    referencedMessage,
    hasImage,
    imageUrl,
    content,
    isCommander,
    isPartner,
  };
}
