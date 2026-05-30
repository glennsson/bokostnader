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

const MAX_REPAIR_COST = 15_000_000;

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

function planKey(omrade) {
  const category = matchMaintenanceCategory(omrade);
  if (category?.label) {
    return category.label.toLowerCase();
  }
  return normalizeOmrade(omrade);
}

function dedupeMaintenancePlan(items) {
  const groups = new Map();

  for (const item of items) {
    const belop = toNumber(item.belop);
    if (!isReasonableRepairCost(belop)) {
      continue;
    }

    const key = `${planKey(item.omrade)}|${item.planlagtAar ?? 0}`;
    const existing = groups.get(key);
    if (!existing || belop > toNumber(existing.belop)) {
      groups.set(key, { ...item, belop });
    }
  }

  return [...groups.values()];
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
function sumBelop(items, getAmount = (item) => item) {
  return items.reduce((sum, item) => sum + toNumber(getAmount(item)), 0);
}

function dedupeEnrichedTiltak(tiltak) {
  const groups = new Map();

  for (const item of tiltak) {
    const belop = toNumber(item.belop);
    if (!isReasonableRepairCost(belop)) {
      continue;
    }
    const key = `${planKey(item.kategori ?? item.omrade)}|${item.planlagtAar ?? 0}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item, belop });
      continue;
    }
    if (belop >= toNumber(existing.belop)) {
      groups.set(key, { ...item, belop });
    }
  }

  return [...groups.values()];
}

export function enrichParsedTilstandsrapport(parsed) {
  const tiltakRaw = (parsed.tiltak ?? [])
    .map((item) => {
      const category = matchMaintenanceCategory(item.omrade);
      const rapportBelop = toNumber(item.belop);
      const fraRapport = isReasonableRepairCost(rapportBelop);
      const belop = fraRapport
        ? rapportBelop
        : category?.defaultCost ?? 0;
      const tg = item.tg != null ? Number(item.tg) : item.nodvendig ? 3 : 2;
      const planlagtAar = planlagtAarForTg(tg, category);

      return {
        ...item,
        belop: toNumber(belop),
        tg,
        kategori: category?.label ?? item.omrade,
        planlagtAar,
        kildeBelop: fraRapport ? "rapport" : belop > 0 ? "database" : "ukjent",
        nodvendig: item.nodvendig ?? tg >= 3,
      };
    })
    .filter((item) => item.belop > 0 && isReasonableRepairCost(item.belop));

  const tiltak = dedupeEnrichedTiltak(tiltakRaw);

  const sumNodvendig = sumBelop(tiltak.filter((t) => t.nodvendig), (t) => t.belop);

  const sumUmiddelbar = sumBelop(
    tiltak.filter((t) => t.planlagtAar === 0 && (t.tg >= 3 || t.nodvendig)),
    (t) => t.belop,
  );

  const maintenancePlan = dedupeMaintenancePlan(
    tiltak.map((t) => ({
      omrade: t.kategori ?? t.omrade,
      belop: t.belop,
      planlagtAar: t.planlagtAar,
      tg: t.tg,
      nodvendig: t.nodvendig,
      kildeBelop: t.kildeBelop,
      beskrivelse: t.beskrivelse,
    })),
  );

  const sumTotal = sumBelop(tiltak, (t) => t.belop);

  return {
    ...parsed,
    tiltak,
    maintenancePlan,
    sumUmiddelbar: toNumber(sumUmiddelbar),
    sumNodvendig: toNumber(sumNodvendig),
    sumTotal: toNumber(sumTotal),
  };
}
