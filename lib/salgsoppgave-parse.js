function parseAmount(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text)
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** Norsk beløp med tusenskille (19 299, 6 200 000). */
const AMOUNT_TOKEN = String.raw`\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?|\d{4,}`;

const AREA_VALUE = String.raw`\d+(?:[.,]\d+)?`;

/** Boareal / P-ROM fra fritekst (FINN-side, salgsoppgave). */
export function parseAreaKvm(rawText) {
  const text = rawText.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const pick = (pattern) => {
    const match = text.match(pattern);
    if (!match?.[1]) {
      return null;
    }
    const value = Number(String(match[1]).replace(",", "."));
    if (!Number.isFinite(value) || value < 10 || value > 2000) {
      return null;
    }
    return Math.round(value * 10) / 10;
  };

  return (
    pick(new RegExp(`Primærrom[^0-9]{0,12}(${AREA_VALUE})\\s*m(?:²|2)?`, "i")) ??
    pick(new RegExp(`Boareal[^0-9]{0,12}(${AREA_VALUE})\\s*(?:kvm|m(?:²|2))?`, "i")) ??
    pick(new RegExp(`Bruksareal[^0-9]{0,12}(${AREA_VALUE})\\s*m(?:²|2)?`, "i")) ??
    pick(new RegExp(`P-ROM[^0-9]{0,12}(${AREA_VALUE})`, "i"))
  );
}

/** Areal fra FINN key-info-etikett (dt/dd). */
export function parseAreaFromLabel(label, valueText) {
  if (!/primær|primary|boareal|bruksareal|p-rom/i.test(label)) {
    return null;
  }
  const match = String(valueText).match(new RegExp(`(${AREA_VALUE})\\s*(?:kvm|m(?:²|2))?`, "i"));
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 10 || value > 2000) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function firstNumberByPattern(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  return parseAmount(match[1]);
}

/** Én kostnadsrad i salgsoppgave-tabell (tett mellom etikett og beløp). */
function parseLineItemCost(text, labelPattern) {
  const pattern = new RegExp(
    `${labelPattern}[^0-9]{0,16}(${AMOUNT_TOKEN})(?:\\s*kr\\.?)?(?:\\s*per\\s*(?:år|ar))?`,
    "i",
  );
  return firstNumberByPattern(text, pattern);
}

function parseDriftskostnaderTable(text) {
  const kommunaleAarlig =
    parseLineItemCost(text, "Kommunale avgifter") ??
    parseLineItemCost(text, "Kommunale avg\\.?");
  const vedlikeholdAarlig =
    parseLineItemCost(text, "Vedlikehold") ??
    parseLineItemCost(text, "Estimert vedlikehold");
  const forsikringAarlig =
    parseLineItemCost(text, "Forsikring") ?? parseLineItemCost(text, "Bygningsforsikring");
  const stromAarlig =
    parseLineItemCost(text, "Strøm og varme") ?? parseLineItemCost(text, "Strøm");
  const driftAarlig =
    parseLineItemCost(text, "Sum driftskostnader") ??
    parseLineItemCost(text, "Totale driftskostnader") ??
    parseLineItemCost(text, "Årlige kostnader");

  return {
    kommunaleAarlig,
    vedlikeholdAarlig,
    forsikringAarlig,
    stromAarlig,
    driftAarlig,
  };
}

/** Kommunale avg. skal være en del av drift – ikke høyere enn sum driftskostnader. */
export function sanitizeListingCosts(fields) {
  if (!fields || typeof fields !== "object") {
    return fields;
  }

  const next = { ...fields };
  const drift = next.driftAarlig;
  const kommunale = next.kommunaleAarlig;

  if (
    kommunale != null &&
    drift != null &&
    drift > 0 &&
    kommunale > drift * 0.85
  ) {
    next.kommunaleAarlig = null;
  }

  return next;
}

/** Parser tekst fra FINN-side eller salgsoppgave-PDF (norsk). */
export function parseSalgsoppgaveText(rawText) {
  const text = rawText.replace(/\s+/g, " ");

  const tableCosts = parseDriftskostnaderTable(text);

  const boligpris =
    firstNumberByPattern(text, new RegExp(`Prisantydning[^0-9]{0,12}(${AMOUNT_TOKEN})`, "i")) ??
    firstNumberByPattern(text, /Prisantydning[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Prisantydning[^0-9]{0,40}kr\.?\s*([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Totalpris[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Kjøpesum[^0-9]{0,40}([\d\s.,]+)/i);

  const kjopspris =
    firstNumberByPattern(text, new RegExp(`Kjøpspris[^0-9]{0,12}(${AMOUNT_TOKEN})`, "i")) ??
    firstNumberByPattern(text, /Kjøpspris[^0-9]{0,40}([\d\s.,]+)/i);

  const boarealKvm = parseAreaKvm(text);

  const felleskostnaderMnd =
    firstNumberByPattern(text, /Felleskostnader[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Fellesutgifter[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Felleskostnader pr\.?\s*mnd[^0-9]{0,20}([\d\s.,]+)/i);

  const kommunaleAarlig =
    tableCosts.kommunaleAarlig ??
    parseLineItemCost(text, "Kommunale avgifter") ??
    parseLineItemCost(text, "Kommunale avg\\.?") ??
    firstNumberByPattern(
      text,
      new RegExp(`Kommunale avg\\.?[^0-9]{0,16}(${AMOUNT_TOKEN})\\s*kr(?:\\s*per\\s*(?:år|ar))?`, "i"),
    ) ??
    firstNumberByPattern(text, /Eiendomsskatt[^0-9]{0,12}([\d\s.,]+)/i);

  const vedlikeholdAarlig =
    tableCosts.vedlikeholdAarlig ??
    parseLineItemCost(text, "Vedlikehold") ??
    parseLineItemCost(text, "Estimert vedlikehold");

  const forsikringAarlig =
    tableCosts.forsikringAarlig ??
    parseLineItemCost(text, "Forsikring") ??
    parseLineItemCost(text, "Bygningsforsikring");

  const stromAarlig =
    tableCosts.stromAarlig ??
    parseLineItemCost(text, "Strøm og varme") ??
    parseLineItemCost(text, "Strøm");

  let driftAarlig = tableCosts.driftAarlig;
  if (driftAarlig == null) {
    const parts = [forsikringAarlig, stromAarlig, kommunaleAarlig, vedlikeholdAarlig].filter(
      (v) => v != null,
    );
    if (parts.length >= 2) {
      driftAarlig = parts.reduce((sum, value) => sum + value, 0);
    }
  } else {
    const lineItems = [forsikringAarlig, stromAarlig, kommunaleAarlig, vedlikeholdAarlig].filter(
      (v) => v != null,
    );
    const lineSum = lineItems.reduce((sum, value) => sum + value, 0);
    if (
      lineItems.length >= 3 &&
      Math.abs(lineSum - driftAarlig) <= Math.max(500, driftAarlig * 0.02)
    ) {
      const forsikringOgStrom = (forsikringAarlig ?? 0) + (stromAarlig ?? 0);
      driftAarlig =
        forsikringOgStrom > 0
          ? forsikringOgStrom
          : lineSum - (kommunaleAarlig ?? 0) - (vedlikeholdAarlig ?? 0);
    }
  }

  const fellesgjeld =
    firstNumberByPattern(text, /Fellesgjeld[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Andel fellesgjeld[^0-9]{0,40}([\d\s.,]+)/i);

  const utleieInntektMnd =
    firstNumberByPattern(text, /Forventet leieinntekt[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Leieinntekt pr\.?\s*mnd[^0-9]{0,20}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Utleieinntekt[^0-9]{0,40}([\d\s.,]+)/i);

  const found = [
    boligpris,
    kjopspris,
    boarealKvm,
    felleskostnaderMnd,
    kommunaleAarlig,
    vedlikeholdAarlig,
    driftAarlig,
    utleieInntektMnd,
  ].some((value) => value != null);

  return sanitizeListingCosts({
    found,
    boligpris,
    kjopspris,
    boarealKvm,
    felleskostnaderMnd,
    kommunaleAarlig,
    vedlikeholdAarlig,
    driftAarlig,
    fellesgjeld,
    utleieInntektMnd,
    forsikringAarlig,
    stromAarlig,
  });
}

export function mergeExtractedData(...sources) {
  const keys = [
    "boligpris",
    "kjopspris",
    "boarealKvm",
    "felleskostnaderMnd",
    "kommunaleAarlig",
    "vedlikeholdAarlig",
    "driftAarlig",
    "fellesgjeld",
    "omkostninger",
    "totalpris",
    "utleieInntektMnd",
  ];
  const merged = {};

  for (const key of keys) {
    for (const source of sources) {
      if (source?.[key] != null) {
        merged[key] = source[key];
        break;
      }
    }
  }

  return merged;
}
