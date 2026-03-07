import OpenAI from 'openai';
import dotenv from 'dotenv';
import { query } from '../db/db.js';
import { embedText, sanitizeText, sha256 } from './embed.js';

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function summarizeChannelHour(channelId, hourStart, hourEnd) {
  const messagesResult = await query(
    `SELECT username, content, created_at
     FROM messages
     WHERE channel_id = $1
       AND created_at >= $2
       AND created_at < $3
     ORDER BY created_at ASC`,
    [channelId, hourStart, hourEnd]
  );

  const rows = messagesResult.rows || [];
  if (!rows.length) return null;

  const transcript = rows
    .slice(-200)
    .map((r) => `${r.username}: ${sanitizeText(r.content)}`)
    .join('\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Summarize Discord server discussions in concise factual bullet points.' },
      { role: 'user', content: `Summarize this chat hour:\n${transcript}` }
    ]
  });

  const summary = completion.choices?.[0]?.message?.content?.trim();
  if (!summary) return null;

  const embedding = await embedText(summary);
  if (!embedding) return null;

  const hash = sha256(`${channelId}|${hourStart.toISOString()}|${summary}`);
  await query(
    `INSERT INTO summaries (channel_id, hour_bucket, summary_text, content_hash, embedding)
     VALUES ($1,$2,$3,$4,$5::vector)
     ON CONFLICT (channel_id, hour_bucket)
     DO UPDATE SET summary_text = EXCLUDED.summary_text, embedding = EXCLUDED.embedding`,
    [channelId, hourStart, summary, hash, `[${embedding.join(',')}]`]
  );

  return summary;
}

export function startHourlySummaries() {
  const run = async () => {
    const end = new Date();
    end.setMinutes(0, 0, 0);
    const start = new Date(end.getTime() - 60 * 60 * 1000);

    const channels = await query(
      `SELECT DISTINCT channel_id FROM messages WHERE created_at >= $1 AND created_at < $2`,
      [start, end]
    );

    for (const row of channels.rows || []) {
      try {
        await summarizeChannelHour(row.channel_id, start, end);
      } catch (err) {
        console.error('[Summarizer] error:', row.channel_id, err.message);
      }
    }
  };

  setInterval(run, 60 * 60 * 1000);
  run().catch((err) => console.error('[Summarizer] startup run failed:', err.message));
}
