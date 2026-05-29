# Sky-lagring med Supabase (gratis)

Appen lagrer kalkulatordata i Supabase når du er innlogget. Uten innlogging brukes fortsatt **localStorage** i nettleseren.

## 1. Opprett prosjekt

1. Gå til [supabase.com](https://supabase.com) og opprett et gratis prosjekt.
2. Noter **Project URL** og **anon public** key (Settings → API).

## 2. Database

1. Supabase-dashboard → **SQL Editor** → New query.
2. Lim inn innholdet fra `supabase/schema.sql` og kjør (**Run**).
3. Kjør også `supabase/schema-snapshots.sql` (historikk / «Mine lagringer»-dashboard).

## 3. Innlogging (magic link)

1. **Authentication** → **Providers** → **Email** → slå på.
2. **Authentication** → **URL Configuration**:
   - **Site URL**: produksjons-URL (f.eks. `https://bokostnader.vercel.app`)
   - **Redirect URLs**: legg til
     - `http://localhost:5173`
     - `http://localhost:5174`
     - produksjons-URL

## 4. Miljøvariabler

Opprett `.env` i prosjektmappen (kopier fra `.env.example`):

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Start dev-server på nytt etter endring: `npm run dev`.

## 5. Vercel (produksjon)

Vercel → prosjektet → **Settings** → **Environment Variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Redeploy etter at variablene er lagt inn.

## Sikkerhet

- **anon**-nøkkelen er ment å ligge i frontend.
- **Row Level Security** sørger for at hver bruker bare ser og endrer egne data.
- Ikke legg **service_role**-nøkkel i appen eller på GitHub.
