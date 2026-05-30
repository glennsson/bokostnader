/**
 * Standardkostnader per bygningsdel (NOK) – brukes når rapport mangler beløp
 * eller som referanse ved TG2/TG3.
 */
export const MAINTENANCE_COST_DATABASE = [
  { keys: ["våtrom", "bad", "baderom"], label: "Våtrom / bad", defaultCost: 250_000, tg2Aar: 5, tg3Aar: 0 },
  { keys: ["innvendig", "overflater", "overflate", "tapet", "maling"], label: "Innvendige overflater", defaultCost: 100_000, tg2Aar: 3, tg3Aar: 0 },
  { keys: ["rom under terreng", "under terreng"], label: "Rom under terreng", defaultCost: 80_000, tg2Aar: 5, tg3Aar: 1 },
  { keys: ["teknisk", "installasjon"], label: "Tekniske installasjoner", defaultCost: 60_000, tg2Aar: 5, tg3Aar: 1 },
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

function tiltakFingerprint(item) {
  return [
    planKey(item.kategori ?? item.omrade),
    item.tg ?? "",
    toNumber(item.belop),
    item.planlagtAar ?? 0,
  ].join("|");
}

/** Streng nøkkel: samme TG + beløp = samme tiltak (ulike områdetekster i rapporten). */
function strictTiltakFingerprint(item) {
  return [item.tg ?? "", toNumber(item.belop)].join("|");
}

/** Synlig #tag – identifiserer samme TG + beløp (duplikater får lik tag). */
export function computeTiltakTag(item) {
  const tg = item.tg ?? 0;
  const belop = toNumber(item.belop);
  const slug = planKey(item.kategori ?? item.omrade)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16);
  const prefix = slug ? `${slug}-` : "";
  return `#${prefix}TG${tg}-${belop}`;
}

function assignTiltakCodes(tiltak) {
  return tiltak.map((item, index) => {
    const next = {
      ...item,
      id: item.id ?? globalThis.crypto?.randomUUID?.() ?? `tiltak-${index}`,
      kode: item.kode ?? `T${String(index + 1).padStart(2, "0")}`,
    };
    return { ...next, tag: computeTiltakTag(next) };
  });
}

function pickMergedBelop(amounts) {
  const valid = [...new Set(amounts.map(toNumber).filter(isReasonableRepairCost))];
  if (valid.length === 0) {
    return 0;
  }
  if (valid.length === 1) {
    return valid[0];
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Samme estimat gjentatt (f.eks. side 5 + sammendrag side 40) – ikke summer.
  if (max <= min * 1.15) {
    return min;
  }

  return sorted[Math.floor(sorted.length / 2)];
}

function mergeTiltakGroup(items) {
  const belop = pickMergedBelop(items.map((item) => item.belop));
  const tgValues = items.map((item) => item.tg).filter((tg) => tg != null);
  const tg =
    tgValues.length > 0
      ? Math.max(...tgValues.map(Number))
      : items[0].tg;
  const category = matchMaintenanceCategory(items[0].kategori ?? items[0].omrade);
  const planlagtAar = planlagtAarForTg(tg ?? 2, category);
  const preferReport = items.find((item) => item.kildeBelop === "rapport") ?? items[0];
  const nodvendig = items.some((item) => item.nodvendig) || (tg ?? 0) >= 3;

  return {
    ...preferReport,
    belop,
    tg,
    kategori: category?.label ?? preferReport.kategori ?? preferReport.omrade,
    omrade: category?.label ?? preferReport.omrade,
    planlagtAar,
    nodvendig,
    kildeBelop: items.some((item) => item.kildeBelop === "rapport")
      ? "rapport"
      : preferReport.kildeBelop,
    slaattSammen: items.length,
  };
}

function dedupeEnrichedTiltak(tiltak) {
  const byCategory = new Map();

  for (const item of tiltak) {
    const belop = toNumber(item.belop);
    if (!isReasonableRepairCost(belop)) {
      continue;
    }

    const key = planKey(item.kategori ?? item.omrade);
    const existing = byCategory.get(key);
    if (!existing) {
      byCategory.set(key, [item]);
    } else {
      existing.push(item);
    }
  }

  const afterCategory = [...byCategory.values()].map(mergeTiltakGroup);

  const byStrict = new Map();
  for (const item of afterCategory) {
    const key = strictTiltakFingerprint(item);
    const existing = byStrict.get(key);
    if (!existing) {
      byStrict.set(key, [item]);
    } else {
      existing.push(item);
    }
  }

  return assignTiltakCodes(
    [...byStrict.values()].map((group) =>
      group.length === 1 ? group[0] : mergeTiltakGroup(group),
    ),
  );
}

export function dedupeTiltakList(tiltakList) {
  const normalized = (tiltakList ?? [])
    .map((item) => {
      const category = matchMaintenanceCategory(item.kategori ?? item.omrade);
      const tg = item.tg != null ? Number(item.tg) : 2;
      return {
        ...item,
        tg,
        belop: toNumber(item.belop),
        planlagtAar: item.planlagtAar ?? planlagtAarForTg(tg, category),
        kategori: item.kategori ?? category?.label ?? item.omrade,
      };
    })
    .filter((item) => isReasonableRepairCost(item.belop));

  return dedupeEnrichedTiltak(normalized);
}

function dedupeMaintenancePlan(items) {
  const groups = new Map();

  for (const item of items) {
    const belop = toNumber(item.belop);
    if (!isReasonableRepairCost(belop)) {
      continue;
    }

    const key = planKey(item.omrade);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, [item]);
    } else {
      existing.push(item);
    }
  }

  return [...groups.values()].map((group) => {
    const merged = mergeTiltakGroup(group);
    return {
      omrade: merged.kategori ?? merged.omrade,
      belop: merged.belop,
      planlagtAar: merged.planlagtAar,
      tg: merged.tg,
      nodvendig: merged.nodvendig,
      kildeBelop: merged.kildeBelop,
      beskrivelse: merged.beskrivelse ?? "",
    };
  });
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

export function syncHomeFromTiltak(home, tiltakList) {
  const tiltak = assignTiltakCodes(
    (tiltakList ?? []).map((item) => {
      const category = matchMaintenanceCategory(item.kategori ?? item.omrade);
      const tg = item.tg != null ? Number(item.tg) : 2;
      const planlagtAar =
        item.manueltRedigert || item.kildeBelop === "manuell"
          ? planlagtAarForTg(tg, category)
          : (item.planlagtAar ?? planlagtAarForTg(tg, category));
      const nodvendig = item.nodvendig ?? tg >= 3;

      return {
        ...item,
        tg,
        planlagtAar,
        nodvendig,
        kategori: item.kategori ?? category?.label ?? item.omrade,
      };
    }),
  );

  const maintenancePlan = tiltak.map((t) => ({
    omrade: t.kategori ?? t.omrade,
    belop: t.belop,
    planlagtAar: t.planlagtAar,
    tg: t.tg,
    nodvendig: t.nodvendig,
    kildeBelop: t.kildeBelop ?? "manuell",
    beskrivelse: t.beskrivelse ?? "",
  }));

  const sumUmiddelbar = sumBelop(
    tiltak.filter((t) => t.planlagtAar === 0 && (t.tg >= 3 || t.nodvendig)),
    (t) => t.belop,
  );
  const sumNodvendig = sumBelop(
    tiltak.filter((t) => t.nodvendig || t.tg >= 3),
    (t) => t.belop,
  );
  const sumTotal = sumBelop(tiltak, (t) => t.belop);
  const engangs = sumUmiddelbar || sumNodvendig || sumTotal;

  return {
    ...home,
    tilstandsTiltak: tiltak,
    maintenancePlan,
    engangsTiltakTilstand: Number.isFinite(engangs) ? Math.round(engangs) : 0,
  };
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
