import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

if (!process.env.NOMIC_API_KEY) {
  console.warn('Missing NOMIC_API_KEY in environment. Embeddings will fail.');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sanitizeText(input) {
  return String(input || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export async function embedText(input) {
  const text = sanitizeText(input);
  if (!text) return null;

  try {
    const response = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'nomic-embed-text-v1.5',
        texts: [text],
        task_type: 'search_document',
      })
    });

    if (!response.ok) {
      console.error('Nomic API Error:', await response.text());
      return null;
    }

    const data = await response.json();
    // Nomic embeddings are 768 dimensions. We need to handle this discrepancy with the 3072 pgvector size.
    return data.embeddings?.[0] || null;
  } catch (err) {
    console.error('Embedding error:', err);
    return null;
  }
}
