/** Maks rimelig utbedringskostnad per tiltak (enkeltbolig). */
const MAX_REPAIR_COST = 15_000_000;

/** gnr/bnr, matrikkel, finnkode-lignende – ikke utbedringskostnader. */
const CADASTRE_CONTEXT =
  /\b(?:gnr\.?|gnr\s|bnr\.?|bnr\s|matrikkel|festenr|seksjon|andelsnr|finnkode|org\.?\s*nr)\b/i;

/** Tall som står rett etter gnr/bnr (f.eks. bnr. 470375). */
const MATRIKKEL_NUMBER = /\b(?:gnr\.?|bnr\.?)\s*(\d[\d\s.,]*)/gi;

function normalizeOmradeKey(omrade, matchCategory) {
  const category = matchCategory?.(omrade);
  if (category?.label) {
    return category.label.toLowerCase();
  }
  return String(omrade ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function toNumber(value) {
  if (value == null || value === "") {
    return 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  let normalized = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(/,(?=-|$)/g, "")
    .replace(",", ".");

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function isReasonableRepairCost(value) {
  return Number.isFinite(value) && value >= 500 && value <= MAX_REPAIR_COST;
}

function isMatrikkelAmount(raw, context = "") {
  const haystack = `${context} ${raw}`;
  if (!CADASTRE_CONTEXT.test(haystack)) {
    return false;
  }

  const digitsOnly = String(raw).replace(/\D/g, "");
  MATRIKKEL_NUMBER.lastIndex = 0;
  let match;
  while ((match = MATRIKKEL_NUMBER.exec(haystack)) !== null) {
    const matrikkelDigits = match[1].replace(/\D/g, "");
    if (matrikkelDigits && matrikkelDigits === digitsOnly) {
      return true;
    }
  }

  return false;
}

function parseAmount(text, { context = "" } = {}) {
  if (!text) {
    return null;
  }

  const raw = String(text).trim();

  if (isMatrikkelAmount(raw, context)) {
    return null;
  }
  const digitsOnly = raw.replace(/\D/g, "");

  // 7+ siffer uten tusenskilletegn → gnr/bnr, FINN-kode, org.nr
  if (digitsOnly.length >= 7 && !/\d{1,3}(?:[.\s]\d{3}){1,}/.test(raw)) {
    return null;
  }

  const value = toNumber(raw);
  if (!isReasonableRepairCost(value)) {
    return null;
  }
  if (value > 1900 && value < 2100) {
    return null;
  }
  return value;
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
  "Radon",
  "Forurenset grunn",
  "Rom under balkong",
];

const TG_MARKER = /\bTG\s*(?:[:\-]?\s*)?([0-3])\b|\bTG([0-3])\b/gi;

function parseTgFromText(text) {
  const match = text.match(/\bTG\s*(?:[:\-]?\s*)?([0-3])\b|\bTG([0-3])\b/i);
  if (!match) {
    return null;
  }
  return Number(match[1] ?? match[2]);
}

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

const SUMMARY_LINE =
  /\b(sum(?:mer)?|samlet|totalt|kostnadsestimat\s+totalt|nødvendige?\s+tiltak)\b/i;

function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index);
  const end = text.indexOf("\n", index);
  return text.slice(start + 1, end >= 0 ? end : undefined);
}

function extractAmountsFromContext(context) {
  const amounts = [];

  const addAmount = (raw, index) => {
    const sliceStart = Math.max(0, index - 60);
    const sliceEnd = index + 80;
    const localContext = context.slice(sliceStart, sliceEnd);

    const line = lineAt(context, index);
    const nearSummary =
      isSummaryLine(line) ||
      SUMMARY_LINE.test(context.slice(Math.max(0, index - 80), index + 40));
    if (nearSummary) {
      return;
    }
    if (isMatrikkelAmount(raw, localContext)) {
      return;
    }
    const value = parseAmount(raw, { context: localContext });
    if (value != null) {
      amounts.push(value);
    }
  };

  const krPatterns = [
    /(\d[\d\s.,]{1,})\s*(?:,\s*-|kr\.?|NOK)/gi,
    /(?:kostnad(?:sestimat)?|estimert|utbedring|pristillegg|utbedringskostnad)[^0-9]{0,30}(\d[\d\s.,]{2,})/gi,
  ];

  for (const pattern of krPatterns) {
    let match;
    while ((match = pattern.exec(context)) !== null) {
      addAmount(match[1], match.index);
    }
  }

  const rangePattern = /(\d[\d\s.,]{2,})\s*(?:-\s*(\d[\d\s.,]{2,}))?\s*(?:kr|NOK)/gi;
  let match;
  while ((match = rangePattern.exec(context)) !== null) {
    const sliceStart = Math.max(0, match.index - 60);
    const localContext = context.slice(sliceStart, match.index + 80);
    const high = match[2] ? parseAmount(match[2], { context: localContext }) : null;
    const low = parseAmount(match[1], { context: localContext });
    if (
      isSummaryLine(lineAt(context, match.index)) ||
      SUMMARY_LINE.test(context.slice(Math.max(0, match.index - 80), match.index + 40))
    ) {
      continue;
    }
    if (high != null) {
      amounts.push(high);
    } else if (low != null) {
      amounts.push(low);
    }
  }

  // Kun tall med eksplisitt kr/NOK (unngår store verdier uten valuta)
  const plainKrPattern = /\b(\d{1,3}(?:[.\s]\d{3}){1,2})\s*(?:kr\.?|NOK)\b/gi;
  while ((match = plainKrPattern.exec(context)) !== null) {
    addAmount(match[1], match.index);
  }

  return amounts;
}

function isSummaryLine(line) {
  return SUMMARY_LINE.test(line);
}

function pickBestAmount(amounts) {
  const valid = amounts.filter(isReasonableRepairCost);
  if (valid.length === 0) {
    return null;
  }
  if (valid.length === 1) {
    return valid[0];
  }
  return Math.min(...valid);
}

function sumBelop(items, predicate = () => true) {
  return items
    .filter(predicate)
    .reduce((sum, item) => sum + toNumber(item.belop), 0);
}

function pickBestDuplicateAmount(amounts) {
  const valid = amounts.map(toNumber).filter(isReasonableRepairCost);
  if (valid.length === 0) {
    return null;
  }
  if (valid.length === 1) {
    return valid[0];
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return sorted.reduce((best, amount) =>
    Math.abs(amount - median) < Math.abs(best - median) ? amount : best,
  );
}

function uniqueTiltak(tiltak, matchCategory) {
  const groups = new Map();

  for (const item of tiltak) {
    const belop = toNumber(item.belop);
    if (!isReasonableRepairCost(belop)) {
      continue;
    }

    // Én rad per bygningsdel (Balkong/Balkonger → samme nøkkel)
    const key = normalizeOmradeKey(item.omrade, matchCategory);

    const existing = groups.get(key);
    const tg = item.tg != null ? Number(item.tg) : null;

    if (!existing) {
      groups.set(key, {
        items: [item],
        belop,
        tg,
      });
      continue;
    }

    existing.items.push(item);
    existing.tg =
      existing.tg != null && tg != null ? Math.max(existing.tg, tg) : (existing.tg ?? tg);
    const bestBelop = pickBestDuplicateAmount(existing.items.map((i) => i.belop));
    existing.belop = bestBelop ?? belop;
  }

  return [...groups.values()].map(({ items, belop, tg }) => {
    const bestItem =
      items.find((item) => toNumber(item.belop) === belop) ??
      items.reduce((best, item) =>
        Math.abs(toNumber(item.belop) - belop) < Math.abs(toNumber(best.belop) - belop)
          ? item
          : best,
      );
    const category = matchCategory?.(bestItem.omrade);
    return {
      ...bestItem,
      omrade: category?.label ?? bestItem.omrade,
      belop: toNumber(belop),
      tg: tg ?? bestItem.tg,
    };
  });
}

function sanitizeOmradeName(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed || /^(?:kr\.?|nok)$/i.test(trimmed)) {
    return "";
  }
  return trimmed.replace(/^(?:kr\.?|nok)\s+/i, "").trim();
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
    const name = sanitizeOmradeName(wordMatch[1]);
    if (name.length >= 3 && !/^TG\s*[0-3]$/i.test(name)) {
      return name;
    }
  }

  return "Ukjent område";
}

function parseByTgMarkers(text) {
  const tiltak = [];
  const tgRegex = TG_MARKER;

  let match;
  while ((match = tgRegex.exec(text)) !== null) {
    const tg = Number(match[1] ?? match[2]);
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
      belop: toNumber(belop),
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

    if (CADASTRE_CONTEXT.test(window.slice(0, 80)) && parseTgFromText(window) == null) {
      continue;
    }

    const tg = parseTgFromText(window);
    const belop = pickBestAmount(extractAmountsFromContext(window));

    if (belop == null) {
      continue;
    }

    tiltak.push({
      omrade,
      beskrivelse: window.slice(omrade.length, 150).replace(/\s+/g, " ").trim(),
      belop: toNumber(belop),
      tg,
      nodvendig: isNodvendigTiltak(tg ?? 2, window),
    });
  }

  return tiltak;
}

function parseTableLines(text) {
  const tiltak = [];
  const patterns = [
    /([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9\s,/()-]{2,50}?)\s+TG\s*(?:[:\-]?\s*)?([0-3])\b[^0-9]{0,120}?(\d[\d\s.,]{2,})/gi,
    /([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9\s,/()-]{2,50}?)\s+TG([0-3])\b[^0-9]{0,120}?(\d[\d\s.,]{2,})/gi,
    /([A-Za-zæøåÆØÅ][A-Za-zæøåÆØÅ0-9\s,/()-]{2,50}?)\s*\|\s*TG\s*([0-3])\s*\|\s*([\d\s.,]+)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const lineContext = text.slice(
        Math.max(0, match.index - 80),
        match.index + match[0].length + 40,
      );
      const belop = parseAmount(match[3] ?? match[4], { context: lineContext });
      if (belop == null) {
        continue;
      }
      const tg = Number(match[2]);
      tiltak.push({
        omrade: sanitizeOmradeName(match[1].trim()) || "Ukjent område",
        beskrivelse: "",
        belop: toNumber(belop),
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

import {
  enrichParsedTilstandsrapport,
  matchMaintenanceCategory,
} from "./maintenance-cost-map.js";

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

  const tiltak = uniqueTiltak(
    [
      ...parseByTgMarkers(text),
      ...parseByOmradeKeywords(text),
      ...parseTableLines(text),
    ],
    matchMaintenanceCategory,
  );

  let sumNodvendig = sumBelop(tiltak, (item) => item.nodvendig);

  let sumAnbefalt = sumBelop(
    tiltak,
    (item) => !item.nodvendig && (item.tg === 2 || item.tg === 1),
  );

  const summaryTotal = parseSummaryTotals(text);
  const sumFromLines = sumBelop(tiltak);
  let sumTotal = sumFromLines > 0 ? sumFromLines : (summaryTotal ?? 0);
  sumTotal = toNumber(sumTotal);

  if (sumNodvendig === 0 && tiltak.some((item) => item.tg === 3)) {
    sumNodvendig = sumBelop(tiltak, (item) => item.tg === 3);
  }

  sumNodvendig = toNumber(sumNodvendig);
  sumAnbefalt = toNumber(sumAnbefalt);

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

  const tgHits = (text.match(/\bTG\s*(?:[:\-]?\s*)?[0-3]\b|\bTG[0-3]\b/gi) ?? []).length;
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
