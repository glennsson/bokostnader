function parseAmount(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text)
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function firstNumberByPattern(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  return parseAmount(match[1]);
}

/** Parser tekst fra FINN-side eller salgsoppgave-PDF (norsk). */
export function parseSalgsoppgaveText(rawText) {
  const text = rawText.replace(/\s+/g, " ");

  const boligpris =
    firstNumberByPattern(text, /Prisantydning[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Prisantydning[^0-9]{0,40}kr\.?\s*([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Totalpris[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Kjøpesum[^0-9]{0,40}([\d\s.,]+)/i);

  const felleskostnaderMnd =
    firstNumberByPattern(text, /Felleskostnader[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Fellesutgifter[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Felleskostnader pr\.?\s*mnd[^0-9]{0,20}([\d\s.,]+)/i);

  const kommunaleAarlig =
    firstNumberByPattern(text, /Kommunale avgifter[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Kommunale avg\.?[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Eiendomsskatt[^0-9]{0,40}([\d\s.,]+)/i);

  const vedlikeholdAarlig =
    firstNumberByPattern(text, /Vedlikehold[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Estimert vedlikehold[^0-9]{0,40}([\d\s.,]+)/i);

  const forsikringAarlig =
    firstNumberByPattern(text, /Forsikring[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Bygningsforsikring[^0-9]{0,40}([\d\s.,]+)/i);

  const stromAarlig =
    firstNumberByPattern(text, /Strøm[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Strøm og varme[^0-9]{0,40}([\d\s.,]+)/i);

  const sumDriftAarlig =
    firstNumberByPattern(text, /Sum driftskostnader[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Totale driftskostnader[^0-9]{0,40}([\d\s.,]+)/i) ??
    firstNumberByPattern(text, /Årlige kostnader[^0-9]{0,40}([\d\s.,]+)/i);

  let driftAarlig = sumDriftAarlig;
  if (driftAarlig == null) {
    const parts = [forsikringAarlig, stromAarlig, kommunaleAarlig, vedlikeholdAarlig].filter(
      (v) => v != null,
    );
    if (parts.length >= 2) {
      driftAarlig = parts.reduce((sum, value) => sum + value, 0);
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
    felleskostnaderMnd,
    kommunaleAarlig,
    vedlikeholdAarlig,
    driftAarlig,
    utleieInntektMnd,
  ].some((value) => value != null);

  return {
    found,
    boligpris,
    felleskostnaderMnd,
    kommunaleAarlig,
    vedlikeholdAarlig,
    driftAarlig,
    fellesgjeld,
    utleieInntektMnd,
    forsikringAarlig,
    stromAarlig,
  };
}

export function mergeExtractedData(...sources) {
  const keys = [
    "boligpris",
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
