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
    buffer.push(msg);

    if (buffer.length >= MAX_CHUNK_SIZE) {
      return this.flush(key);
    }
    return null;
  }

  flush(channelId) {
    const buffer = this.buffers.get(channelId) || [];
    if (buffer.length < MIN_CHUNK_SIZE) return null;

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
