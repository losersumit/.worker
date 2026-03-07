import { supabase } from '../db/db.js';
import { embedText } from './embed.js';

export async function retrieveContext(question, options = {}) {
  const embedding = await embedText(question);
  if (!embedding) return [];

  const {
    channelId = null,
    hours = 24,
    limit = 5
  } = options;

  let allHits = [];

  // Try fetching chunks
  try {
    const { data: chunkHits, error: chunkErr } = await supabase.rpc('match_chunks', {
      query_embedding: embedding,
      match_threshold: 0.8, // Adjust as needed
      match_count: limit,
      p_channel_id: channelId,
      p_hours: hours
    });

    if (!chunkErr && chunkHits) {
      allHits = allHits.concat(chunkHits);
    } else if (chunkErr) {
      console.error("RPC match_chunks failed:", chunkErr);
    }
  } catch (err) {
    console.error('Failed to retrieve chunks via RPC:', err);
  }

  // Try fetching summaries
  try {
    const { data: summaryHits, error: sumErr } = await supabase.rpc('match_summaries', {
      query_embedding: embedding,
      match_threshold: 0.8,
      match_count: limit,
      p_channel_id: channelId,
      p_hours: hours
    });

    if (!sumErr && summaryHits) {
      allHits = allHits.concat(summaryHits);
    } else if (sumErr) {
      console.error("RPC match_summaries failed:", sumErr);
    }
  } catch (err) {
    console.error('Failed to retrieve summaries via RPC:', err);
  }

  // Fallback if RPC doesn't exist yet but user wants to use standard text search (or just return empty if migrations fail)
  if (allHits.length === 0) {
    // You can implement standard text search fallback here if needed using `.textSearch()`
    // but vector search needs RPCs on Supabase.
  }

  // Sort merged results by distance
  allHits.sort((a, b) => a.distance - b.distance);

  return allHits.slice(0, limit);
}
