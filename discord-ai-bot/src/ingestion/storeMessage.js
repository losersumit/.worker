import { supabase } from '../db/db.js';
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

  const { error } = await supabase
    .from('messages')
    .insert({
      message_id: payload.message_id,
      user_id: payload.user_id,
      username: payload.username,
      channel_id: payload.channel_id,
      channel_name: payload.channel_name,
      content: payload.content,
      created_at: payload.timestamp.toISOString(),
      content_hash: contentHash
    });

  if (error) {
    if (error.code !== '23505') { // Ignore duplicate key errors entirely
      console.error('Error inserting message to Supabase:', error);
    }
  }

  return payload;
}
