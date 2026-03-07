import { query } from '../db/db.js';
import { embedText } from './embed.js';

function toPgVectorLiteral(arr) {
  return `[${arr.join(',')}]`;
}

export async function retrieveContext(question, options = {}) {
  const embedding = await embedText(question);
  if (!embedding) return [];

  const {
    channelId = null,
    hours = 24,
    limit = 5
  } = options;

  const vectorLiteral = toPgVectorLiteral(embedding);

  const rows = await query(
    `
    WITH chunk_hits AS (
      SELECT
        'chunk' AS source,
        channel_id,
        start_time AS ts,
        text,
        embedding <-> $1::vector AS distance
      FROM chunks
      WHERE ($2::text IS NULL OR channel_id = $2)
        AND end_time > NOW() - ($3::text || ' hours')::interval
      ORDER BY embedding <-> $1::vector
      LIMIT $4
    ),
    summary_hits AS (
      SELECT
        'summary' AS source,
        channel_id,
        hour_bucket AS ts,
        summary_text AS text,
        embedding <-> $1::vector AS distance
      FROM summaries
      WHERE ($2::text IS NULL OR channel_id = $2)
        AND hour_bucket > NOW() - ($3::text || ' hours')::interval
      ORDER BY embedding <-> $1::vector
      LIMIT $4
    )
    SELECT *
    FROM (
      SELECT * FROM chunk_hits
      UNION ALL
      SELECT * FROM summary_hits
    ) all_hits
    ORDER BY distance ASC
    LIMIT $4
    `,
    [vectorLiteral, channelId, String(hours), limit]
  );

  return rows.rows || [];
}
