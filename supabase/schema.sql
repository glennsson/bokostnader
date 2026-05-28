-- Kjør i Supabase: SQL Editor → New query → Run
-- Én rad per innlogget bruker (JSON med hele kalkulatoren).

create table if not exists public.kalkulator_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.kalkulator_data enable row level security;

create policy "Les egen kalkulator"
  on public.kalkulator_data
  for select
  using (auth.uid() = user_id);

create policy "Opprett egen kalkulator"
  on public.kalkulator_data
  for insert
  with check (auth.uid() = user_id);

create policy "Oppdater egen kalkulator"
  on public.kalkulator_data
  for update
  using (auth.uid() = user_id);

create policy "Slett egen kalkulator"
  on public.kalkulator_data
  for delete
  using (auth.uid() = user_id);
