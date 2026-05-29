function parseAmount(text) {
  if (!text) {
    return null;
  }

  let normalized = String(text)
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(/,(?=-|$)/g, "")
    .replace(",", ".");

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 500) {
    return null;
  }
  if (value > 1900 && value < 2100) {
    return null;
  }
  return Math.round(value);
}

/** Bygningsdeler – NS 3600 / boligsalgsrapport (korte og lange navn). */
export const BYGNINGSDELER = [
  "Pipeinspeksjon",
  "VVS-installasjoner",
  "VVS",
  "Elektrisk anlegg",
  "Elektrisk",
  "Rom under terreng",
  "Innvendige overflater",
  "Utvendige overflater",
  "Tekniske installasjoner",
  "Teknisk installasjon",
  "Ventilasjon",
  "Varmeanlegg",
  "Varme",
  "Våtrom",
  "Kjøkken",
  "Taktekking",
  "Tak",
  "Utvendig",
  "Innvendig",
  "Krypkjeller",
  "Kryploft",
  "Kjeller",
  "Loft",
  "Vinduer",
  "Ytterdører",
  "Dører",
  "Balkong",
  "Balkonger",
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
  "Radon",
  "Forurenset grunn",
  "Rom under balkong",
];

const NODVENDIG_MARKERS =
  /\b(nødvendig|nødvendige|påkrevd|påkrevde|må\s+(?:utføres|gjennomføres|utbedres)|bør\s+gjennomføres|skal\s+utbedres|må\s+utbedres|akutt|alvorlig)\b/i;

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

  const krPatterns = [
    /(\d[\d\s.,]{1,})\s*(?:,\s*-|kr\.?|NOK)/gi,
    /(?:kostnad(?:sestimat)?|estimert|utbedring|pristillegg|utbedringskostnad)[^0-9]{0,30}(\d[\d\s.,]{2,})/gi,
  ];

  for (const pattern of krPatterns) {
    let match;
    while ((match = pattern.exec(context)) !== null) {
      const value = parseAmount(match[1]);
      if (value != null) {
        amounts.push(value);
      }
    }
  }

  const rangePattern = /(\d[\d\s.,]{2,})\s*(?:-\s*(\d[\d\s.,]{2,}))?\s*(?:kr|NOK)/gi;
  let match;
  while ((match = rangePattern.exec(context)) !== null) {
    const high = match[2] ? parseAmount(match[2]) : null;
    const low = parseAmount(match[1]);
    if (high != null) {
      amounts.push(high);
    } else if (low != null) {
      amounts.push(low);
    }
  }

  const plainPattern = /\b(\d{1,3}(?:[.\s]\d{3}){1,}|\d{5,})\b/g;
  while ((match = plainPattern.exec(context)) !== null) {
    const value = parseAmount(match[1]);
    if (value != null && value >= 3000) {
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

function findOmradeInText(beforeText) {
  const sorted = [...BYGNINGSDELER].sort((a, b) => b.length - a.length);
  const lower = beforeText.toLowerCase();
  for (const del of sorted) {
    const idx = lower.lastIndexOf(del.toLowerCase());
    if (idx >= 0 && idx >= lower.length - del.length - 30) {
      return del;
    }
  }

  const wordMatch = beforeText.match(
    /([A-ZÆØÅ][a-zæøåA-ZÆØÅ0-9\s\-]{2,35})\s*$/u,
  );
  if (wordMatch?.[1]) {
    const name = wordMatch[1].trim();
    if (name.length >= 3 && !/^TG\s*[0-3]$/i.test(name)) {
      return name;
    }
  }

  return "Ukjent område";
}

function parseByTgMarkers(text) {
  const tiltak = [];
  const tgRegex = /\bTG\s*[:\-]?\s*([0-3])\b/gi;
  let match;

  while ((match = tgRegex.exec(text)) !== null) {
    const tg = Number(match[1]);
    const before = text.slice(Math.max(0, match.index - 150), match.index);
    const after = text.slice(match.index, match.index + 500);
    const context = `${before} ${after}`;
    const belop = pickBestAmount(extractAmountsFromContext(context));

    if (belop == null && tg < 2) {
      continue;
    }
    if (belop == null) {
      continue;
    }

    const omrade = findOmradeInText(before);
    tiltak.push({
      omrade,
      beskrivelse: after.slice(0, 120).replace(/\s+/g, " ").trim(),
      belop,
      tg,
      nodvendig: isNodvendigTiltak(tg, context),
    });
  }

  return tiltak;
}

function parseByOmradeKeywords(text) {
  const tiltak = [];
  const omradeRegex = new RegExp(
    `\\b(${BYGNINGSDELER.map(escapeRegex).join("|")})\\b`,
    "gi",
  );

  let omradeMatch;
  while ((omradeMatch = omradeRegex.exec(text)) !== null) {
    const omrade = omradeMatch[1];
    const window = text.slice(omradeMatch.index, omradeMatch.index + 800);
    const tgMatch = window.match(/\bTG\s*[:\-]?\s*([0-3])\b/i);
    const tg = tgMatch ? Number(tgMatch[1]) : null;
    const belop = pickBestAmount(extractAmountsFromContext(window));

    if (belop == null) {
      continue;
    }

    tiltak.push({
      omrade,
      beskrivelse: window.slice(omrade.length, 150).replace(/\s+/g, " ").trim(),
      belop,
      tg,
      nodvendig: isNodvendigTiltak(tg ?? 2, window),
    });
  }

  return tiltak;
}

function parseTableLines(text) {
  const tiltak = [];
  const patterns = [
    /([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9\s,/()-]{2,50}?)\s+TG\s*([0-3])\b[^0-9]{0,120}?(\d[\d\s.,]{2,})/gi,
    /([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9\s,/()-]{2,50}?)\s*\|\s*TG\s*([0-3])\s*\|\s*([\d\s.,]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const belop = parseAmount(match[3] ?? match[4]);
      if (belop == null) {
        continue;
      }
      const tg = Number(match[2]);
      tiltak.push({
        omrade: match[1].trim(),
        beskrivelse: "",
        belop,
        tg,
        nodvendig: isNodvendigTiltak(tg, match[0]),
      });
    }
  }

  return tiltak;
}

function parseSummaryTotals(text) {
  const patterns = [
    /sum(?:mer)?\s+(?:av\s+)?(?:kostnadsestimat|tiltak|utbedringer|utbedring)[^0-9]{0,50}([\d\s.,]+)/i,
    /samlet\s+(?:kostnadsestimat|utbedringskostnad)[^0-9]{0,50}([\d\s.,]+)/i,
    /totalt\s+kostnadsestimat[^0-9]{0,50}([\d\s.,]+)/i,
    /kostnadsestimat\s+totalt[^0-9]{0,50}([\d\s.,]+)/i,
    /estimerte?\s+utbedringskostnader[^0-9]{0,50}([\d\s.,]+)/i,
    /utbedringskostnader?\s+(?:totalt|samlet)?[^0-9]{0,30}([\d\s.,]+)/i,
    /nødvendige?\s+tiltak[^0-9]{0,40}([\d\s.,]+)/i,
  ];

  for (const pattern of patterns) {
    const value = parseAmount(text.match(pattern)?.[1]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

import { enrichParsedTilstandsrapport } from "./maintenance-cost-map.js";

/**
 * Parser tekst fra tilstandsrapport / boligsalgsrapport (PDF eller nettside).
 */
export function parseTilstandsrapportText(rawText) {
  if (!rawText || rawText.length < 50) {
    return {
      found: false,
      tiltak: [],
      sumNodvendig: 0,
      sumAnbefalt: 0,
      sumTotal: 0,
      debug: { textLength: 0, tgHits: 0 },
    };
  }

  const text = rawText
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");

  const tiltak = uniqueTiltak([
    ...parseByTgMarkers(text),
    ...parseByOmradeKeywords(text),
    ...parseTableLines(text),
  ]);

  let sumNodvendig = tiltak
    .filter((item) => item.nodvendig)
    .reduce((sum, item) => sum + item.belop, 0);

  let sumAnbefalt = tiltak
    .filter((item) => !item.nodvendig && (item.tg === 2 || item.tg === 1))
    .reduce((sum, item) => sum + item.belop, 0);

  const summaryTotal = parseSummaryTotals(text);
  const sumFromLines = tiltak.reduce((sum, item) => sum + item.belop, 0);
  let sumTotal = summaryTotal ?? sumFromLines;

  if (sumNodvendig === 0 && tiltak.some((item) => item.tg === 3)) {
    sumNodvendig = tiltak.filter((item) => item.tg === 3).reduce((s, i) => s + i.belop, 0);
  }

  let finalTiltak = tiltak;
  if (finalTiltak.length === 0 && sumTotal > 0) {
    finalTiltak = [
      {
        omrade: "Samlet estimat (rapport)",
        beskrivelse: "Totalt kostnadsestimat funnet i rapporten",
        belop: sumTotal,
        tg: 3,
        nodvendig: true,
      },
    ];
    sumNodvendig = sumTotal;
  }

  const tgHits = (text.match(/\bTG\s*[:\-]?\s*[0-3]\b/gi) ?? []).length;
  const found = finalTiltak.length > 0 || sumTotal > 0;

  const base = {
    found,
    tiltak: finalTiltak,
    sumNodvendig,
    sumAnbefalt,
    sumTotal,
    debug: { textLength: text.length, tgHits },
  };

  return found ? enrichParsedTilstandsrapport(base) : base;
}
