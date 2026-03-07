import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '../.env' }); // Reaching up to main .env

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// We'll throw an error if they try to use the raw pg query without a postgres string
export async function query(text, params = []) {
  throw new Error("Raw SQL 'query()' is disabled! You must use Supabase RPCs for pgvector operations or provide a raw Postgres connection string.");
}

export async function closeDb() {
  // No-op for supabase client
}
