import { query } from '../db/db.js';
import { sanitizeText, sha256 } from '../rag/embed.js';

export async function storeMessage(message) {
  const content = sanitizeText(message.content);
  if (!content) return null;

  const payload = {
    message_id: message.message_id,
    user_id: message.user_id,
    username: message.username,
    channel_id: message.channel_id,
    channel_name: message.channel_name,
    content,
    timestamp: new Date(message.timestamp)
  };

  const contentHash = sha256(`${payload.channel_id}|${payload.user_id}|${payload.content}|${payload.timestamp.toISOString()}`);

  await query(
    `INSERT INTO messages (message_id, user_id, username, channel_id, channel_name, content, created_at, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (message_id) DO NOTHING`,
    [
      payload.message_id,
      payload.user_id,
      payload.username,
      payload.channel_id,
      payload.channel_name,
      payload.content,
      payload.timestamp,
      contentHash
    ]
  );

  return payload;
}
