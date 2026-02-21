/**
 * Resolves an attachment URL from a Discord message link.
 * @param {import('discord.js').Client} client - The Discord client.
 * @param {string} messageLink - The Discord message link.
 * @returns {Promise<{url: string, isAttachment: boolean}|null>} - Result object or null.
 */
async function resolveAttachmentFromLink(client, messageLink) {
  if (!messageLink || !messageLink.includes('discord.com/channels/')) {
    console.error('Invalid message link provided:', messageLink);
    return null;
  }

  try {
    // Message Link format: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
    const parts = messageLink.split('/');
    const messageId = parts.pop();
    const channelId = parts.pop();
    const guildId = parts.pop(); // Not strictly needed if we fetch channel directly

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.error(`Channel not found or not text-based: ${channelId}`);
      return null;
    }

    const message = await channel.messages.fetch(messageId);
    if (!message) {
      console.error(`Message not found: ${messageId}`);
      return null;
    }

    if (message.attachments.size > 0) {
      return { url: message.attachments.first().url, isAttachment: true };
    }

    // parsing media link from content
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = message.content.match(urlRegex);
    if (match) {
      // Clean the URL: remove trailing '>', ')', ']', or punctuation usually found at end of sentence
      let cleanUrl = match[0].replace(/[>)\].]+$/, '');
      return { url: cleanUrl, isAttachment: false };
    }

    console.warn(`No attachments or media links found in message: ${messageLink}`);
    return null;
  } catch (error) {
    console.error('Error resolving attachment from link:', error);
    return null;
  }
}

/**
 * Resolves full content (text + files) from a Discord message link.
 * @param {import('discord.js').Client} client - The Discord client.
 * @param {string} messageLink - The Discord message link.
 * @returns {Promise<{content: string, files: string[]}|null>} - Result object or null.
 */
async function resolveMessageFromLink(client, messageLink) {
  if (!messageLink || !messageLink.includes('discord.com/channels/')) {
    return null;
  }

  try {
    const parts = messageLink.split('/');
    const messageId = parts.pop();
    const channelId = parts.pop();

    // Validate IDs
    if (!messageId || !channelId) return null;

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.error(`resolveMessageFromLink: Channel not found or invalid: ${channelId}`);
      return null;
    }

    const message = await channel.messages.fetch(messageId);
    if (!message) {
      console.error(`resolveMessageFromLink: Message not found: ${messageId}`);
      return null;
    }

    return {
      content: message.content,
      // Pass the attachment URLs directly rather than internal Discord.js Attachment objects
      files: message.attachments.map(a => a.url)
    };
  } catch (error) {
    console.error('Error resolving message from link:', error);
    return null;
  }
}

export { resolveAttachmentFromLink, resolveMessageFromLink };
