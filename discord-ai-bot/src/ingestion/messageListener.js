import { storeMessage } from './storeMessage.js';

export function setupMessageListener(client, onStoredMessage) {
  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.content) return;
      if (message.content.length > 2000) return;

      const stored = await storeMessage({
        message_id: message.id,
        user_id: message.author.id,
        username: message.member?.displayName || message.author.username,
        channel_id: message.channel.id,
        channel_name: message.channel.name || 'DM',
        content: message.content,
        timestamp: message.createdAt.toISOString()
      });

      if (stored && typeof onStoredMessage === 'function') {
        await onStoredMessage(stored, message);
      }
    } catch (err) {
      console.error('[Ingestion] messageCreate error:', err.message);
    }
  });
}
