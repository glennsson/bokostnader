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

function isFalseTgAmountMatch(context, matchIndex) {
  const before = context.slice(Math.max(0, matchIndex - 3), matchIndex);
  return /TG\s*$/i.test(before);
}

function buildOmradePattern() {
  const parts = [...BYGNINGSDELER].sort((a, b) => b.length - a.length).map(escapeRegex);
  return new RegExp(`\\b(${parts.join("|")})\\b`, "gi");
}

function findNextOmradeIndex(text, fromIndex) {
  if (fromIndex >= text.length) {
    return text.length;
  }

  const pattern = buildOmradePattern();
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(text);
  return match ? match.index : text.length;
}

function sliceTiltakSegment(text, startIndex, { maxLength = 200, mode = "tg" } = {}) {
  const hardEnd = Math.min(text.length, startIndex + maxLength);
  let end = hardEnd;

  if (mode === "tg") {
    const tail = text.slice(startIndex, hardEnd);
    const nextTgRelative = tail.slice(1).search(/\bTG\s*[0-3]\b|\bTG[0-3]\b/i);
    if (nextTgRelative >= 0) {
      end = Math.min(end, startIndex + 1 + nextTgRelative);
    }
  } else {
    const nextOmrade = findNextOmradeIndex(text, startIndex + 1);
    if (nextOmrade > startIndex) {
      end = Math.min(end, nextOmrade);
    }
  }

  return text.slice(startIndex, end);
}

function extractAmountsFromContext(context) {
  const amounts = [];

  const addAmount = (raw, index) => {
    if (isFalseTgAmountMatch(context, index)) {
      return;
    }

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
    if (isFalseTgAmountMatch(context, match.index)) {
      continue;
    }

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

/** Velg beløpet nærmest TG-markøren (typisk første kr-beløp i segmentet). */
function pickPrimaryAmount(amounts) {
  const valid = amounts.filter(isReasonableRepairCost);
  if (valid.length === 0) {
    return null;
  }
  if (valid.length === 1) {
    return valid[0];
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max <= min * 1.15) {
    return min;
  }

  return valid[0];
}

function sumBelop(items, predicate = () => true) {
  return items
    .filter(predicate)
    .reduce((sum, item) => sum + toNumber(item.belop), 0);
}

function pickBestDuplicateAmount(amounts) {
  const valid = [...new Set(amounts.map(toNumber).filter(isReasonableRepairCost))];
  if (valid.length === 0) {
    return null;
  }
  if (valid.length === 1) {
    return valid[0];
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max <= min * 1.15) {
    return min;
  }

  return sorted[Math.floor(sorted.length / 2)];
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
    const omrade = category?.label ?? bestItem.omrade;
    if (isJunkOmradeName(omrade)) {
      return null;
    }
    return {
      ...bestItem,
      omrade,
      belop: toNumber(belop),
      tg: tg ?? bestItem.tg,
    };
  }).filter(Boolean);
}

function sanitizeOmradeName(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed || /^(?:kr\.?|nok)$/i.test(trimmed)) {
    return "";
  }

  const cleaned = trimmed.replace(/^(?:kr\.?|nok)\s+/i, "").trim();
  if (isJunkOmradeName(cleaned)) {
    return "";
  }

  return cleaned;
}

/** Standardfraser i rapporten – ikke reelle bygningsdeler. */
function isJunkOmradeName(name) {
  const lower = String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  if (!lower || lower.length < 3) {
    return true;
  }

  return (
    /\bslike anslag\b/.test(lower) ||
    /\bgis for\b/.test(lower) ||
    /\bmindre avvik\b/.test(lower) ||
    /\btilstandsgrad\b/.test(lower) ||
    /\banskaffelses\b/.test(lower) ||
    /\bgenerelt\b/.test(lower) ||
    /\bmerknad\b/.test(lower) ||
    /\banmerkning\b/.test(lower) ||
    /\btilstandssv/.test(lower) ||
    /\brapporten\b/.test(lower) ||
    /\bkostnadsestimat\b/.test(lower) ||
    /^sum\b/.test(lower) ||
    /^totalt\b/.test(lower)
  );
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

/** Finn bygningsdel i lengre kontekst (Konsekvens/tiltak-blokker). */
function findOmradeInContext(text, tiltakText = "") {
  const thematicSources = [tiltakText, text];
  for (const chunk of thematicSources) {
    const lower = String(chunk ?? "").toLowerCase();
    if (!lower) {
      continue;
    }
    if (/\bdrenering\b|\bkondens\b|\binnsig\b|\bfukt\b|\bisolasjon\b/.test(lower)) {
      return "Drenering";
    }
    if (/\bmuggsopp\b|\bråte\b|\binneklima\b/.test(lower)) {
      return "Rom under terreng";
    }
  }

  const sorted = [...BYGNINGSDELER].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  for (const del of sorted) {
    if (lower.includes(del.toLowerCase())) {
      return del;
    }
  }

  const tail = findOmradeInText(text.slice(-200));
  return tail === "Ukjent område" ? "Utbedring (rapport)" : tail;
}

function extractTiltakTextBeforeKostnadsestimat(beforeText) {
  const tiltakMarkers = [...beforeText.matchAll(/Tiltak\s*:\s*/gi)];
  if (tiltakMarkers.length === 0) {
    return "";
  }

  const lastTiltak = tiltakMarkers[tiltakMarkers.length - 1];
  let tiltakText = beforeText.slice(lastTiltak.index + lastTiltak[0].length).replace(/\s+/g, " ").trim();

  if (tiltakText.length < 25 || /^Konsekvens\s*:/i.test(tiltakText)) {
    const konsekvensMarkers = [...beforeText.matchAll(/Konsekvens\s*:\s*/gi)];
    if (konsekvensMarkers.length > 0) {
      const lastKonsekvens = konsekvensMarkers[konsekvensMarkers.length - 1];
      const afterKonsekvens = beforeText.slice(lastKonsekvens.index + lastKonsekvens[0].length);
      const nestedTiltak = afterKonsekvens.match(/Tiltak\s*:\s*([\s\S]+)$/i);
      if (nestedTiltak?.[1]) {
        tiltakText = nestedTiltak[1].replace(/\s+/g, " ").trim();
      }
    }
  }

  return tiltakText.replace(/\bKonsekvens\s*:[\s\S]*$/i, "").trim();
}

function isRejectableTiltak(item) {
  if (isJunkOmradeName(item.omrade) || isJunkOmradeName(item.beskrivelse)) {
    return true;
  }
  const haystack = `${item.omrade ?? ""} ${item.beskrivelse ?? ""} ${item.kategori ?? ""}`;
  if (isJunkOmradeName(haystack)) {
    return true;
  }
  return false;
}

/** Eksplisitt bygningsdel + TG + beløp (ikke bare intervall i brødtekst). */
function hasExplicitTiltakLines(text) {
  const parts = [...BYGNINGSDELER].sort((a, b) => b.length - a.length).map(escapeRegex);
  const pattern = new RegExp(
    `\\b(?:${parts.join("|")})\\b[^.]{0,45}\\bTG\\s*(?:[:\\-]?\\s*)?[0-3]\\b[^0-9]{0,18}(\\d[\\d\\s.,]{2,})\\s*(?:kr\\.?|NOK)\\b`,
    "i",
  );
  return pattern.test(text);
}

function parseTgNear(text, index, radius = 120) {
  const slice = text.slice(Math.max(0, index - radius), index + radius);
  return parseTgFromText(slice);
}

function parseCostRanges(text) {
  const ranges = [];
  const seen = new Set();
  const patterns = [
    /kostnadsestimat\s*[:\-]?\s*(\d[\d\s.,]{2,})(?:\s*-\s*(\d[\d\s.,]{2,}))?(?:\s*(?:kr\.?|NOK))?(?=\s|$|[.;])/gi,
    /(\d[\d\s.,]{2,})\s*-\s*(\d[\d\s.,]{2,})\s*(?:kr\.?|NOK)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (isFalseTgAmountMatch(text, match.index)) {
        continue;
      }

      const localContext = text.slice(Math.max(0, match.index - 50), match.index + match[0].length + 30);
      if (
        isSummaryLine(lineAt(text, match.index)) ||
        SUMMARY_LINE.test(text.slice(Math.max(0, match.index - 80), match.index + 40))
      ) {
        continue;
      }

      const low = parseAmount(match[1], { context: localContext });
      const high = match[2] ? parseAmount(match[2], { context: localContext }) : null;
      if (low == null) {
        continue;
      }

      const belopMin = low;
      const belopMax = high != null && high >= low ? high : low;
      const key = `${match.index}|${belopMin}|${belopMax}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      ranges.push({
        belopMin,
        belopMax,
        index: match.index,
        tg: parseTgNear(text, match.index),
      });
    }
  }

  return ranges;
}

function buildTiltakFromKostnadsestimat(text, matchIndex, { belopMin, belopMax }) {
  const before = text.slice(Math.max(0, matchIndex - 1200), matchIndex);
  const tiltakText = extractTiltakTextBeforeKostnadsestimat(before);
  const isRange = belopMax > belopMin;
  const belop = belopMax;
  const contextForOmrade = `${before.slice(-600)} ${tiltakText}`;
  const omrade = findOmradeInContext(contextForOmrade, tiltakText);
  const tg = parseTgNear(text, matchIndex) ?? (/\bnødvendig/i.test(tiltakText) ? 3 : 2);
  const beskrivelse =
    tiltakText.length >= 20
      ? tiltakText.slice(0, 220)
      : isRange
        ? `Estimat ${belopMin.toLocaleString("nb-NO")} – ${belopMax.toLocaleString("nb-NO")} kr`
        : `Kostnadsestimat ${belop.toLocaleString("nb-NO")} kr`;

  return {
    omrade,
    beskrivelse,
    belop,
    belopMin,
    belopMax,
    tg,
    nodvendig: tg >= 3 || /\bnødvendig/i.test(tiltakText),
    kildeBelop: "rapport",
  };
}

/** Alle «Kostnadsestimat:» – enkeltbeløp og intervaller (med eller uten «kr»). */
function parseKostnadsestimatEntries(text) {
  const results = [];
  const seen = new Set();
  const costPattern =
    /Kostnadsestimat\s*[:\-]?\s*(\d[\d\s.,]{2,})(?:\s*-\s*(\d[\d\s.,]{2,}))?(?:\s*(?:kr\.?|NOK))?(?=\s|$|[.;])/gi;

  let match;
  while ((match = costPattern.exec(text)) !== null) {
    const localContext = text.slice(Math.max(0, match.index - 50), match.index + match[0].length + 30);
    const low = parseAmount(match[1], { context: localContext });
    const high = match[2] ? parseAmount(match[2], { context: localContext }) : null;
    if (low == null) {
      continue;
    }

    const belopMin = low;
    const belopMax = high != null && high >= low ? high : low;
    const key = `${match.index}|${belopMin}|${belopMax}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    results.push(
      buildTiltakFromKostnadsestimat(text, match.index, { belopMin, belopMax }),
    );
  }

  return results;
}

function tiltakFromCostRanges(text, ranges) {
  if (ranges.length === 0) {
    return [];
  }

  return ranges.map((range) =>
    buildTiltakFromKostnadsestimat(text, range.index, {
      belopMin: range.belopMin,
      belopMax: range.belopMax,
    }),
  );
}

function parseByTgMarkers(text) {
  const tiltak = [];
  const tgRegex = TG_MARKER;

  let match;
  while ((match = tgRegex.exec(text)) !== null) {
    const tg = Number(match[1] ?? match[2]);
    const before = text.slice(Math.max(0, match.index - 150), match.index);
    const segment = sliceTiltakSegment(text, match.index, { maxLength: 160 });
    const context = `${before} ${segment}`;
    const belop = pickPrimaryAmount(extractAmountsFromContext(segment));

    if (belop == null && tg < 2) {
      continue;
    }
    if (belop == null) {
      continue;
    }

    const omrade = findOmradeInText(before);
    const entry = {
      omrade,
      beskrivelse: segment.slice(0, 120).replace(/\s+/g, " ").trim(),
      belop: toNumber(belop),
      tg,
      nodvendig: isNodvendigTiltak(tg, context),
    };
    if (isRejectableTiltak(entry)) {
      continue;
    }
    tiltak.push(entry);
  }

  return tiltak;
}

function parseByOmradeKeywords(text) {
  const tiltak = [];
  const omradeRegex = buildOmradePattern();

  let omradeMatch;
  while ((omradeMatch = omradeRegex.exec(text)) !== null) {
    const omrade = omradeMatch[1];
    const window = sliceTiltakSegment(text, omradeMatch.index, { maxLength: 220, mode: "omrade" });

    if (CADASTRE_CONTEXT.test(window.slice(0, 80)) && parseTgFromText(window) == null) {
      continue;
    }

    const tgBelopMatch = window.match(
      /\bTG\s*(?:[:\-]?\s*)?([0-3])\b[^0-9]{0,20}(\d[\d\s.,]{2,})\s*(?:kr\.?|NOK)/i,
    );
    if (!tgBelopMatch) {
      continue;
    }

    const tg = Number(tgBelopMatch[1]);
    const belop = parseAmount(tgBelopMatch[2], { context: window });
    if (belop == null) {
      continue;
    }

    const entry = {
      omrade,
      beskrivelse: window.slice(omrade.length, 150).replace(/\s+/g, " ").trim(),
      belop: toNumber(belop),
      tg,
      nodvendig: isNodvendigTiltak(tg, window),
    };
    if (isRejectableTiltak(entry)) {
      continue;
    }

    tiltak.push(entry);
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
      const omrade = sanitizeOmradeName(match[1].trim());
      if (!omrade) {
        continue;
      }
      const tg = Number(match[2]);
      const entry = {
        omrade,
        beskrivelse: "",
        belop: toNumber(belop),
        tg,
        nodvendig: isNodvendigTiltak(tg, match[0]),
      };
      if (isRejectableTiltak(entry)) {
        continue;
      }
      tiltak.push(entry);
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

  const kostnadsestimatTiltak = parseKostnadsestimatEntries(text);
  const costRanges = parseCostRanges(text);
  const hasExplicit = hasExplicitTiltakLines(text);

  let tiltak;
  if (kostnadsestimatTiltak.length > 0) {
    tiltak = hasExplicit
      ? uniqueTiltak(
          [
            ...parseByTgMarkers(text),
            ...parseByOmradeKeywords(text),
            ...parseTableLines(text),
            ...kostnadsestimatTiltak,
          ],
          matchMaintenanceCategory,
        ).filter((item) => !isRejectableTiltak(item))
      : kostnadsestimatTiltak;
  } else if (costRanges.length > 0 && !hasExplicit) {
    tiltak = tiltakFromCostRanges(text, costRanges);
  } else {
    tiltak = uniqueTiltak(
      [
        ...parseByTgMarkers(text),
        ...parseByOmradeKeywords(text),
        ...parseTableLines(text),
      ],
      matchMaintenanceCategory,
    ).filter((item) => !isRejectableTiltak(item));

    if (tiltak.length === 0 && costRanges.length > 0) {
      tiltak = tiltakFromCostRanges(text, costRanges);
    }
  }

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
