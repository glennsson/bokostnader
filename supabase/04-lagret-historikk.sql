-- Navn i Supabase SQL Editor: 04 · Lagret historikk (dashboard)
-- Fil: supabase/04-lagret-historikk.sql
-- Kjør ETTER 01-kalkulator-grunnlag.sql
-- Trygg å kjøre flere ganger (idempotent).

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

drop policy if exists "Les egne snapshots" on public.kalkulator_snapshots;
create policy "Les egne snapshots"
  on public.kalkulator_snapshots
  for select
  using (auth.uid() = user_id);

drop policy if exists "Opprett egne snapshots" on public.kalkulator_snapshots;
create policy "Opprett egne snapshots"
  on public.kalkulator_snapshots
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Oppdater egne snapshots" on public.kalkulator_snapshots;
create policy "Oppdater egne snapshots"
  on public.kalkulator_snapshots
  for update
  using (auth.uid() = user_id);

drop policy if exists "Slett egne snapshots" on public.kalkulator_snapshots;
create policy "Slett egne snapshots"
  on public.kalkulator_snapshots
  for delete
  using (auth.uid() = user_id);
