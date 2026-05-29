-- Kjør i Supabase SQL Editor ETTER schema.sql
-- Lagrer historikk med flere lagringer per bruker (dashboard)

create table if not exists public.kalkulator_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  navn text not null default 'Uten navn',
  total_maanedlig numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kalkulator_snapshots_user_id_idx
  on public.kalkulator_snapshots (user_id, updated_at desc);

alter table public.kalkulator_snapshots enable row level security;

create policy "Les egne snapshots"
  on public.kalkulator_snapshots
  for select
  using (auth.uid() = user_id);

create policy "Opprett egne snapshots"
  on public.kalkulator_snapshots
  for insert
  with check (auth.uid() = user_id);

create policy "Oppdater egne snapshots"
  on public.kalkulator_snapshots
  for update
  using (auth.uid() = user_id);

create policy "Slett egne snapshots"
  on public.kalkulator_snapshots
  for delete
  using (auth.uid() = user_id);
