-- Run this in Supabase SQL editor

create table if not exists public.rag_messages (
  id bigint generated always as identity primary key,
  message_id text unique not null,
  user_id text not null,
  username text not null,
  channel_id text not null,
  channel_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_rag_messages_channel_time
  on public.rag_messages(channel_id, created_at desc);

create table if not exists public.rag_chunks (
  id bigint generated always as identity primary key,
  channel_id text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_rag_chunks_channel_time
  on public.rag_chunks(channel_id, end_time desc);

create table if not exists public.rag_summaries (
  id bigint generated always as identity primary key,
  channel_id text not null,
  hour_bucket timestamptz not null,
  summary_text text not null,
  created_at timestamptz not null default now(),
  unique(channel_id, hour_bucket)
);

create index if not exists idx_rag_summaries_channel_hour
  on public.rag_summaries(channel_id, hour_bucket desc);
<<<<<<< ours
<<<<<<< HEAD
=======
>>>>>>> theirs

-- Trusted identity source for authority claims.
create table if not exists public.verified_identities (
  id bigint generated always as identity primary key,
  guild_id text not null,
  user_id text not null,
  username text,
  is_owner boolean not null default false,
  is_admin boolean not null default false,
  role_names jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique(guild_id, user_id)
);

create index if not exists idx_verified_identities_guild_user
  on public.verified_identities(guild_id, user_id);
<<<<<<< ours
=======
>>>>>>> main
=======
>>>>>>> theirs
