/**
 * Standardkostnader per bygningsdel (NOK) – brukes når rapport mangler beløp
 * eller som referanse ved TG2/TG3.
 */
export const MAINTENANCE_COST_DATABASE = [
  { keys: ["våtrom", "bad", "baderom"], label: "Våtrom / bad", defaultCost: 250_000, tg2Aar: 5, tg3Aar: 0 },
  { keys: ["elektrisk", "el-anlegg"], label: "Elektrisk anlegg", defaultCost: 50_000, tg2Aar: 8, tg3Aar: 1 },
  { keys: ["tak", "taktekking"], label: "Tak / taktekking", defaultCost: 180_000, tg2Aar: 7, tg3Aar: 2 },
  { keys: ["vindu", "vinduer", "dør", "ytterdør"], label: "Vinduer / dører", defaultCost: 120_000, tg2Aar: 10, tg3Aar: 3 },
  { keys: ["drenering", "grunnmur", "fundament"], label: "Drenering / grunnmur", defaultCost: 200_000, tg2Aar: 6, tg3Aar: 1 },
  { keys: ["pipe", "pipeinspeksjon"], label: "Pipe", defaultCost: 40_000, tg2Aar: 5, tg3Aar: 0 },
  { keys: ["kjøkken"], label: "Kjøkken", defaultCost: 150_000, tg2Aar: 8, tg3Aar: 2 },
  { keys: ["vvs", "varme", "varmeanlegg"], label: "VVS / varme", defaultCost: 90_000, tg2Aar: 6, tg3Aar: 1 },
  { keys: ["krypkjeller", "kjeller", "loft", "kryploft"], label: "Kjeller / loft", defaultCost: 80_000, tg2Aar: 7, tg3Aar: 2 },
  { keys: ["balkong", "terrasse"], label: "Balkong / terrasse", defaultCost: 100_000, tg2Aar: 8, tg3Aar: 3 },
  { keys: ["fasade", "utvendig"], label: "Utvendig / fasade", defaultCost: 160_000, tg2Aar: 9, tg3Aar: 3 },
  { keys: ["ventilasjon"], label: "Ventilasjon", defaultCost: 45_000, tg2Aar: 6, tg3Aar: 1 },
  { keys: ["radon"], label: "Radon", defaultCost: 35_000, tg2Aar: 2, tg3Aar: 0 },
];

function normalizeOmrade(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchMaintenanceCategory(omrade) {
  const haystack = normalizeOmrade(omrade);
  for (const entry of MAINTENANCE_COST_DATABASE) {
    if (entry.keys.some((key) => haystack.includes(key))) {
      return entry;
    }
  }
  return null;
}

export function planlagtAarForTg(tg, category) {
  if (tg >= 3) {
    return category?.tg3Aar ?? 0;
  }
  if (tg === 2) {
    return category?.tg2Aar ?? 3;
  }
  return category?.tg2Aar ?? 5;
}

/**
 * Beriker parsede tiltak med databasekostnad, planlagt år og kilde.
 */
export function enrichParsedTilstandsrapport(parsed) {
  const tiltak = (parsed.tiltak ?? []).map((item) => {
    const category = matchMaintenanceCategory(item.omrade);
    const fraRapport = item.belop > 0;
    const belop = fraRapport ? item.belop : category?.defaultCost ?? item.belop ?? 0;
    const tg = item.tg ?? (item.nodvendig ? 3 : 2);
    const planlagtAar = planlagtAarForTg(tg, category);

    return {
      ...item,
      belop,
      tg,
      kategori: category?.label ?? item.omrade,
      planlagtAar,
      kildeBelop: fraRapport ? "rapport" : belop > 0 ? "database" : "ukjent",
      nodvendig: item.nodvendig ?? tg >= 3,
    };
  });

  const sumNodvendig = tiltak
    .filter((t) => t.nodvendig)
    .reduce((s, t) => s + t.belop, 0);

  const sumUmiddelbar = tiltak
    .filter((t) => t.planlagtAar === 0 && (t.tg >= 3 || t.nodvendig))
    .reduce((s, t) => s + t.belop, 0);

  const maintenancePlan = tiltak
    .filter((t) => t.belop > 0)
    .map((t) => ({
      omrade: t.kategori ?? t.omrade,
      belop: t.belop,
      planlagtAar: t.planlagtAar,
      tg: t.tg,
      nodvendig: t.nodvendig,
      kildeBelop: t.kildeBelop,
      beskrivelse: t.beskrivelse,
    }));

  return {
    ...parsed,
    tiltak,
    maintenancePlan,
    sumUmiddelbar,
    sumNodvendig: sumNodvendig || parsed.sumNodvendig,
    sumTotal: tiltak.reduce((s, t) => s + t.belop, 0) || parsed.sumTotal,
  };
}
