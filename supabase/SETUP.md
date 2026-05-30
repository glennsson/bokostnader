# Sky-lagring med Supabase (gratis)

Appen lagrer kalkulatordata i Supabase når du er innlogget. Uten innlogging brukes **localStorage**.

## 1. Opprett prosjekt

1. [supabase.com](https://supabase.com) → nytt prosjekt
2. **Settings → API**: noter **Project URL**, **anon public**, **service_role** (kun server)

## 2. Database (kjør i denne rekkefølgen)

SQL Editor → New query → lim inn og **Run** for hver fil:

| Rekkefølge | Fil | Navn i SQL Editor |
|------------|-----|-------------------|
| 1 | `01-kalkulator-grunnlag.sql` | **01 · Kalkulator grunnlag** |
| 2 | `02-tilstandsrapport-pdf-bucket.sql` | **02 · Tilstandsrapport PDF-bucket** |
| 3 | `03-boliger-scenarioer-vedlikehold.sql` | **03 · Boliger, scenarioer og vedlikehold** |
| 4 | `04-lagret-historikk.sql` | **04 · Lagret historikk (dashboard)** |

> Feil «policy … already exists» betyr at filen allerede er kjørt – hopp over den og gå videre.  
> Alle schema-filer kan kjøres på nytt uten feil (idempotente).

## 3. Realtime (tilstandsrapport)

**Database** → **Replication** → slå på for tabellen `tilstandsrapport_jobs`.

Uten dette oppdateres ikke lasteindikatoren automatisk etter PDF-opplasting.

## 4. Innlogging (magic link)

1. **Authentication** → **Providers** → **Email** → på
2. **URL Configuration**:
   - Site URL: produksjons-URL
   - Redirect: `http://localhost:5173`, `http://localhost:5174`, produksjons-URL

## 5. Miljøvariabler

Kopier `.env.example` → `.env.local`:

```env
# Frontend
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Kun server (asynk PDF-parsing)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role...
```

Start på nytt: `npm run dev`

## 6. Vercel (produksjon)

**Settings → Environment Variables** (alle miljøer):

| Variabel | Bruk |
|----------|------|
| `VITE_SUPABASE_URL` | Frontend |
| `VITE_SUPABASE_ANON_KEY` | Frontend |
| `SUPABASE_URL` | API `/api/tilstandsrapport/process-job` |
| `SUPABASE_SERVICE_ROLE_KEY` | API (hemmelig) |

Redeploy etter endring.

## Asynk tilstandsrapport (flyt)

1. Bruker laster opp PDF → **Storage** (`tilstandsrapport/{user_id}/…`)
2. Rad i `tilstandsrapport_jobs` med `status = processing`
3. Server parser PDF og setter `completed` + `result` (JSON)
4. Frontend lytter via **Realtime** og fyller tabell + likviditetsbudsjett

## Sikkerhet

- **anon** i frontend er OK med Row Level Security
- **service_role** kun på server / Vercel – aldri i React-kode eller GitHub
- `.env.local` er i `.gitignore`
