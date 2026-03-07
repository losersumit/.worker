import { sanitizeText } from './embed.js';

const MIN_CHUNK_SIZE = 5;
const MAX_CHUNK_SIZE = 10;

export class Chunker {
  constructor() {
    this.buffers = new Map();
  }

  addMessage(msg) {
    const key = msg.channel_id;
    if (!this.buffers.has(key)) this.buffers.set(key, []);
    const buffer = this.buffers.get(key);

    // Semantic Heuristic: If it's been more than 5 minutes since the last message in this buffer, flush the buffer FIRST because it's likely a new topic.
    if (buffer.length > 0) {
      const lastMsgDate = new Date(buffer[buffer.length - 1].timestamp).getTime();
      const newMsgDate = new Date(msg.timestamp).getTime();
      if ((newMsgDate - lastMsgDate) > (5 * 60 * 1000)) { // 5 minutes
        const staleChunk = this.flush(key);
        this.buffers.get(key).push(msg); // Add the new message to a fresh buffer
        return staleChunk;
      }
    }

    buffer.push(msg);

    if (buffer.length >= MAX_CHUNK_SIZE) {
      return this.flush(key);
    }
    return null;
  }

  flush(channelId) {
    const buffer = this.buffers.get(channelId);
    if (!buffer || buffer.length < MIN_CHUNK_SIZE) return null;

    const chunkMessages = buffer.splice(0, MAX_CHUNK_SIZE);
    const text = chunkMessages
      .map((m) => `${m.username}: ${sanitizeText(m.content)}`)
      .join('\n');

    return {
      channel_id: channelId,
      start_time: chunkMessages[0].timestamp,
      end_time: chunkMessages[chunkMessages.length - 1].timestamp,
      text
    };
  }

  flushStale(maxAgeMs = 120000) {
    const now = Date.now();
    const chunks = [];

    for (const [channelId, buffer] of this.buffers.entries()) {
      if (buffer.length < MIN_CHUNK_SIZE) continue;
      const lastTs = new Date(buffer[buffer.length - 1].timestamp).getTime();
      if (now - lastTs > maxAgeMs) {
        const chunk = this.flush(channelId);
        if (chunk) chunks.push(chunk);
      }
    }

    return chunks;
  }
}
