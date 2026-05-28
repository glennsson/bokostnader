function parseAmount(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text)
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** Bygningsdeler som ofte forekommer i norske tilstandsrapporter (NS 3600 / eldre format). */
export const BYGNINGSDELER = [
  "Pipeinspeksjon",
  "VVS-installasjoner",
  "Elektrisk anlegg",
  "Rom under terreng",
  "Innvendige overflater",
  "Utvendige overflater",
  "Tekniske installasjoner",
  "Teknisk installasjon",
  "Ventilasjon",
  "Varmeanlegg",
  "Våtrom",
  "Kjøkken",
  "Taktekking",
  "Tak",
  "Utvendig",
  "Innvendig",
  "Krypkjeller",
  "Kjeller",
  "Loft",
  "Vinduer",
  "Dører",
  "Balkong",
  "Terrasse",
  "Garasje",
  "Carport",
  "Uteområder",
  "Drenering",
  "Grunnmur",
  "Fundament",
  "Pipe",
  "Bygning",
  "Eiendom",
];

const NODVENDIG_MARKERS =
  /\b(nødvendig|nødvendige|påkrevd|påkrevde|må\s+(?:utføres|gjennomføres|utbedres)|bør\s+gjennomføres|skal\s+utbedres|må\s+utbedres)\b/i;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNodvendigTiltak(tg, context) {
  if (tg >= 3) {
    return true;
  }
  if (tg === 2 && NODVENDIG_MARKERS.test(context)) {
    return true;
  }
  return NODVENDIG_MARKERS.test(context);
}

function extractAmountsFromContext(context) {
  const amounts = [];
  const rangePattern =
    /(\d[\d\s.,]{2,})\s*(?:-\s*(\d[\d\s.,]{2,}))?\s*kr/gi;
  let match;

  while ((match = rangePattern.exec(context)) !== null) {
    const low = parseAmount(match[1]);
    const high = match[2] ? parseAmount(match[2]) : null;
    if (high != null) {
      amounts.push(high);
    } else if (low != null) {
      amounts.push(low);
    }
  }

  const estimatePattern =
    /(?:kostnad(?:sestimat)?|estimert(?:\s+kostnad)?|utbedringskostnad)[^0-9]{0,25}([\d\s.,]+)/gi;
  while ((match = estimatePattern.exec(context)) !== null) {
    const value = parseAmount(match[1]);
    if (value != null) {
      amounts.push(value);
    }
  }

  return amounts;
}

function pickBestAmount(amounts) {
  if (amounts.length === 0) {
    return null;
  }
  return Math.max(...amounts);
}

function uniqueTiltak(tiltak) {
  const seen = new Set();
  return tiltak.filter((item) => {
    const key = `${item.omrade}|${item.belop}|${item.tg}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Parser tekst fra tilstandsrapport / boligsalgsrapport (PDF eller nettside).
 * Henter TG og kostnadsestimat per bygningsdel der det finnes.
 */
export function parseTilstandsrapportText(rawText) {
  if (!rawText || rawText.length < 80) {
    return {
      found: false,
      tiltak: [],
      sumNodvendig: 0,
      sumAnbefalt: 0,
      sumTotal: 0,
    };
  }

  const text = rawText.replace(/\s+/g, " ");
  const tiltak = [];

  const omradeRegex = new RegExp(
    `\\b(${BYGNINGSDELER.map(escapeRegex).join("|")})\\b`,
    "gi",
  );

  let omradeMatch;
  while ((omradeMatch = omradeRegex.exec(text)) !== null) {
    const omrade = omradeMatch[1];
    const start = omradeMatch.index;
    const window = text.slice(start, start + 700);

    const tgMatch = window.match(/\bTG\s*([0-3])\b/i);
    const tg = tgMatch ? Number(tgMatch[1]) : null;

    const amounts = extractAmountsFromContext(window);
    const belop = pickBestAmount(amounts);
    if (belop == null) {
      continue;
    }

    const nodvendig = isNodvendigTiltak(tg ?? 2, window);
    let beskrivelse = "";

    const tiltakMatch = window.match(
      /(?:tiltak|anbefaling|kommentar)[^.]{0,12}[.:]\s*([^.]{15,160})/i,
    );
    if (tiltakMatch?.[1]) {
      beskrivelse = tiltakMatch[1].trim();
    } else {
      beskrivelse = window.slice(omrade.length, Math.min(window.length, 120)).trim();
    }

    tiltak.push({
      omrade,
      beskrivelse: beskrivelse.slice(0, 180),
      belop,
      tg,
      nodvendig,
    });
  }

  const linePattern =
    /([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9\s,/()-]{2,45}?)\s+TG\s*([0-3])\b([^]{0,200}?)(\d[\d\s.,]{2,})(?:\s*-\s*(\d[\d\s.,]{2,}))?\s*kr/gi;
  let lineMatch;
  while ((lineMatch = linePattern.exec(text)) !== null) {
    const omrade = lineMatch[1].trim();
    const tg = Number(lineMatch[2]);
    const context = lineMatch[3] ?? "";
    const belop =
      parseAmount(lineMatch[5]) ??
      parseAmount(lineMatch[4]) ??
      pickBestAmount(extractAmountsFromContext(context));

    if (belop == null) {
      continue;
    }

    tiltak.push({
      omrade,
      beskrivelse: context.trim().slice(0, 180),
      belop,
      tg,
      nodvendig: isNodvendigTiltak(tg, context),
    });
  }

  const deduped = uniqueTiltak(tiltak);

  let sumNodvendig = deduped
    .filter((item) => item.nodvendig)
    .reduce((sum, item) => sum + item.belop, 0);

  let sumAnbefalt = deduped
    .filter((item) => !item.nodvendig && (item.tg === 2 || item.tg === 1))
    .reduce((sum, item) => sum + item.belop, 0);

  const summaryPatterns = [
    /sum(?:mer)?\s+(?:av\s+)?(?:kostnadsestimat|tiltak|utbedringer)[^0-9]{0,40}([\d\s.,]+)/i,
    /samlet\s+kostnadsestimat[^0-9]{0,40}([\d\s.,]+)/i,
    /totalt\s+kostnadsestimat[^0-9]{0,40}([\d\s.,]+)/i,
    /kostnadsestimat\s+totalt[^0-9]{0,40}([\d\s.,]+)/i,
  ];

  let summaryTotal = null;
  for (const pattern of summaryPatterns) {
    const value = parseAmount(text.match(pattern)?.[1]);
    if (value != null) {
      summaryTotal = value;
      break;
    }
  }

  const sumFromLines = deduped.reduce((sum, item) => sum + item.belop, 0);
  const sumTotal = summaryTotal ?? sumFromLines;

  if (sumNodvendig === 0 && deduped.some((item) => item.tg === 3)) {
    sumNodvendig = deduped.filter((item) => item.tg === 3).reduce((s, i) => s + i.belop, 0);
  }

  const found = deduped.length > 0 || sumTotal > 0;

  return {
    found,
    tiltak: deduped,
    sumNodvendig,
    sumAnbefalt,
    sumTotal,
  };
}
