-- Navn i Supabase SQL Editor: 03 · Boliger, scenarioer og vedlikehold
-- Fil: supabase/03-boliger-scenarioer-vedlikehold.sql
-- Kjør ETTER 02-tilstandsrapport-pdf-bucket.sql
-- Trygg å kjøre flere ganger (idempotent).

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  adresse text,
  finn_url text,
  boligpris numeric,
  felleskostnader_mnd numeric default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_user_idx
  on public.properties (user_id, updated_at desc);

alter table public.properties enable row level security;

drop policy if exists "Les egne eiendommer" on public.properties;
create policy "Les egne eiendommer"
  on public.properties for select using (auth.uid() = user_id);
drop policy if exists "Opprett egne eiendommer" on public.properties;
create policy "Opprett egne eiendommer"
  on public.properties for insert with check (auth.uid() = user_id);
drop policy if exists "Oppdater egne eiendommer" on public.properties;
create policy "Oppdater egne eiendommer"
  on public.properties for update using (auth.uid() = user_id);
drop policy if exists "Slett egne eiendommer" on public.properties;
create policy "Slett egne eiendommer"
  on public.properties for delete using (auth.uid() = user_id);

-- ========== Scenarioer (kalkulator-input per eiendom) ==========
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid references public.properties (id) on delete cascade,
  navn text not null default 'Scenario',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scenarios_user_idx
  on public.scenarios (user_id, updated_at desc);

alter table public.scenarios enable row level security;

drop policy if exists "Les egne scenarioer" on public.scenarios;
create policy "Les egne scenarioer"
  on public.scenarios for select using (auth.uid() = user_id);
drop policy if exists "Opprett egne scenarioer" on public.scenarios;
create policy "Opprett egne scenarioer"
  on public.scenarios for insert with check (auth.uid() = user_id);
drop policy if exists "Oppdater egne scenarioer" on public.scenarios;
create policy "Oppdater egne scenarioer"
  on public.scenarios for update using (auth.uid() = user_id);
drop policy if exists "Slett egne scenarioer" on public.scenarios;
create policy "Slett egne scenarioer"
  on public.scenarios for delete using (auth.uid() = user_id);

-- ========== Vedlikehold fra tilstandsrapport ==========
create table if not exists public.maintenance_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid references public.properties (id) on delete cascade,
  job_id uuid references public.tilstandsrapport_jobs (id) on delete set null,
  omrade text not null,
  tg int,
  belop numeric not null default 0,
  planlagt_aar int not null default 0,
  nodvendig boolean not null default true,
  kilde text,
  beskrivelse text,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_costs_property_idx
  on public.maintenance_costs (property_id, planlagt_aar);

alter table public.maintenance_costs enable row level security;

drop policy if exists "Les egne vedlikeholdskostnader" on public.maintenance_costs;
create policy "Les egne vedlikeholdskostnader"
  on public.maintenance_costs for select using (auth.uid() = user_id);
drop policy if exists "Opprett egne vedlikeholdskostnader" on public.maintenance_costs;
create policy "Opprett egne vedlikeholdskostnader"
  on public.maintenance_costs for insert with check (auth.uid() = user_id);
drop policy if exists "Slett egne vedlikeholdskostnader" on public.maintenance_costs;
create policy "Slett egne vedlikeholdskostnader"
  on public.maintenance_costs for delete using (auth.uid() = user_id);

-- FK fra tilstandsrapport_jobs → properties
alter table public.tilstandsrapport_jobs
  drop constraint if exists tilstandsrapport_jobs_property_id_fkey;
alter table public.tilstandsrapport_jobs
  add constraint tilstandsrapport_jobs_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete set null;
