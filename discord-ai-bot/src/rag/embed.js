import crypto from 'crypto';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in environment');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = 'text-embedding-3-large';

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

  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });

  return resp.data?.[0]?.embedding || null;
}
