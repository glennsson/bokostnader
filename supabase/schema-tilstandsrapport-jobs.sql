-- Kjør ETTER schema.sql OG schema-scenarios.sql (property_id FK)
-- Asynk parsing av tilstandsrapport + Storage

-- ========== Storage-bucket ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tilstandsrapport',
  'tilstandsrapport',
  false,
  26214400,
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

-- Brukere laster opp til mappe {user_id}/...
create policy "Egen mappe: les PDF"
  on storage.objects for select
  using (
    bucket_id = 'tilstandsrapport'
    and auth.uid()::text = split_part(name, '/', 1)
  );

create policy "Egen mappe: last opp PDF"
  on storage.objects for insert
  with check (
    bucket_id = 'tilstandsrapport'
    and auth.uid()::text = split_part(name, '/', 1)
  );

create policy "Egen mappe: slett PDF"
  on storage.objects for delete
  using (
    bucket_id = 'tilstandsrapport'
    and auth.uid()::text = split_part(name, '/', 1)
  );

-- ========== Jobb-tabell ==========
create table if not exists public.tilstandsrapport_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  file_name text,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  property_id uuid references public.properties (id) on delete set null,
  home_context text,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tilstandsrapport_jobs_user_idx
  on public.tilstandsrapport_jobs (user_id, updated_at desc);

alter table public.tilstandsrapport_jobs enable row level security;

create policy "Les egne rapport-jobber"
  on public.tilstandsrapport_jobs for select
  using (auth.uid() = user_id);

create policy "Opprett egne rapport-jobber"
  on public.tilstandsrapport_jobs for insert
  with check (auth.uid() = user_id);

-- Realtime: Dashboard → Database → Replication → slå på for tilstandsrapport_jobs
