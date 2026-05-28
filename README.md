# Boligkostnader-kalkulator

React-app for å sammenligne boligkostnader: flere boformer, status quo vs ny bolig, FINN-import og delbar lenke.

## Kjør lokalt

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
npm install
npm run dev
```

Åpne URL-en Vite viser (ofte `http://localhost:5173/` eller `5174/`).

## Dele kalkulatoren

### 1. Delbar lenke (raskest)

1. Fyll inn tall i appen
2. Klikk **Kopier delbar lenke**
3. Send lenken til andre – de får samme utfylte data

### 2. Publiser på nett (anbefalt: Vercel)

Appen er satt opp for [Vercel](https://vercel.com) (gratis):

1. Last prosjektet opp til GitHub
2. Gå til [vercel.com/new](https://vercel.com/new) og importer repoet
3. Vercel oppdager innstillinger fra `vercel.json` automatisk
4. Klikk **Deploy**

Du får en offentlig URL, f.eks. `https://boligkostnader.vercel.app`.

### Andre alternativer

| Plattform | Passer for | Merknad |
|-----------|------------|---------|
| **Vercel** | Denne appen | Frontend + FINN-API i samme deploy |
| **Netlify** | Frontend | Krever egen backend for FINN-import |
| **GitHub Pages** | Kun frontend | Ingen FINN-import uten ekstra API |
| **Streamlit** | Ny app i Python | Må bygges på nytt – ikke nødvendig |

## Streamlit?

Streamlit er bra for raske Python-prototyper, men denne appen er allerede bygget i React. Å flytte til Streamlit betyr full omskriving. Anbefaling: behold React og deploy på Vercel.

## Teknologi

- React + Vite
- Express (lokal utvikling)
- Vercel Serverless (`api/finn/extract.js`) i produksjon
