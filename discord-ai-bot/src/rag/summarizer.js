import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { supabase } from '../db/db.js';
import { embedText, sanitizeText, sha256 } from './embed.js';

dotenv.config({ path: '../.env' }); // Reaching up to main .env
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY_ONE });

export async function summarizeChannelHour(channelId, hourStart, hourEnd) {
  const { data: rows, error } = await supabase
    .from('messages')
    .select('username, content, created_at')
    .eq('channel_id', channelId)
    .gte('created_at', hourStart.toISOString())
    .lt('created_at', hourEnd.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase error fetching messages:', error);
    return null;
  }

  if (!rows || !rows.length) return null;

  const transcript = rows
    .slice(-200)
    .map((r) => `${r.username}: ${sanitizeText(r.content)}`)
    .join('\n');

  try {
    const completion = await groq.chat.completions.create({
      model: 'mixtral-8x7b-32768',
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

    // UPSERT into summaries
    const { error: upsertError } = await supabase
      .from('summaries')
      .upsert({
        channel_id: channelId,
        hour_bucket: hourStart.toISOString(),
        summary_text: summary,
        content_hash: hash,
        embedding: `[${embedding.join(',')}]`
      }, { onConflict: 'channel_id,hour_bucket' });

    if (upsertError) console.error('Supabase error upserting summary:', upsertError);

    return summary;
  } catch (err) {
    console.error('Summarize error:', err);
    return null;
  }
}

export function startHourlySummaries() {
  const run = async () => {
    const end = new Date();
    end.setMinutes(0, 0, 0);
    const start = new Date(end.getTime() - 60 * 60 * 1000);

    // We can't do SELECT DISTINCT easily without RPC in supabase, but we can just group by or fetch all and filter in memory since it's just recent messages
    const { data: messages, error } = await supabase
      .from('messages')
      .select('channel_id')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString());

    if (error) {
      console.error('[Summarizer] Error fetching active channels:', error);
      return;
    }

    const uniqueChannels = [...new Set((messages || []).map(m => m.channel_id))];

    for (const channel_id of uniqueChannels) {
      try {
        await summarizeChannelHour(channel_id, start, end);
      } catch (err) {
        console.error('[Summarizer] error:', channel_id, err.message);
      }
    }
  };

  setInterval(run, 60 * 60 * 1000);
  run().catch((err) => console.error('[Summarizer] startup run failed:', err.message));
}
