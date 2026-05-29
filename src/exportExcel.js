import * as XLSX from "xlsx";

function roundKr(value) {
  return Math.round(Number(value) || 0);
}

function displayName(home) {
  return home.adresse?.trim() || home.name || "Uten navn";
}

function appendSection(rows, title, tableRows) {
  rows.push([]);
  rows.push([title]);
  rows.push(...tableRows);
}

function buildCostComparisonSheet({
  statusQuo,
  statusQuoTotals,
  nyBolig,
  nyBoligTotals,
  nyBoligCostMonthly,
  nyBoligCostYearly,
  moveDeltaMonthly,
  moveDeltaYearly,
  forms,
  results,
}) {
  const rows = [
    ["Boligkostnader – Kostnadssammenligning"],
    ["Generert", new Date().toLocaleString("nb-NO")],
    [],
    ["Flyttesammenligning (nåværende vs ny bolig)"],
    [
      "Bolig",
      "Månedlig lån (kr)",
      "Årlig drift (kr)",
      "Total per måned (kr)",
      "Total per år (kr)",
    ],
    [
      displayName(statusQuo),
      roundKr(statusQuoTotals.monthlyLoanCost),
      roundKr(statusQuoTotals.yearlyRunningCosts),
      roundKr(statusQuoTotals.monthlyTotal),
      roundKr(statusQuoTotals.yearlyTotal),
    ],
    [
      displayName(nyBolig),
      roundKr(nyBoligTotals.monthlyLoanCost),
      roundKr(nyBoligTotals.yearlyRunningCosts),
      roundKr(nyBoligCostMonthly),
      roundKr(nyBoligCostYearly),
    ],
    [
      "Differanse (ny − nå)",
      "",
      "",
      roundKr(moveDeltaMonthly),
      roundKr(moveDeltaYearly),
    ],
  ];

  if (nyBolig.utleieAktivert) {
    rows.push([
      `${displayName(nyBolig)} (etter utleie)`,
      "",
      "",
      roundKr(nyBoligTotals.monthlyNetCost),
      roundKr(nyBoligTotals.yearlyNetCost),
    ]);
  }

  appendSection(rows, "Sammenligning av boformer", [
    [
      "Boform / adresse",
      "Boligpris (kr)",
      "Egenkapital (kr)",
      "Lånebehov (kr)",
      "Rente (%)",
      "Nedbetaling (år)",
      "Månedlig lån (kr)",
      "Total per måned (kr)",
      "Total per år (kr)",
    ],
    ...results.map((result) => {
      const form = forms.find((item) => item.id === result.id);
      return [
        form ? displayName(form) : result.name,
        roundKr(form?.boligpris),
        roundKr(form?.egenkapital),
        roundKr(result.totals.principal),
        form?.rente ?? "",
        form?.nedbetalingstid ?? "",
        roundKr(result.totals.monthlyLoanCost),
        roundKr(result.totals.monthlyTotal),
        roundKr(result.totals.yearlyTotal),
      ];
    }),
  ]);

  return rows;
}

function buildCapitalSheet({
  statusQuo,
  statusQuoTotals,
  nyBolig,
  nyBoligTotals,
}) {
  const rows = [
    ["Boligkostnader – Flyttekapital / egenkapital"],
    ["Generert", new Date().toLocaleString("nb-NO")],
    [],
    ["Nåværende bolig (salg)"],
    ["Post", "Beløp (kr)"],
    ["Kjøpspris", roundKr(statusQuo.kjopspris)],
    [
      statusQuoTotals.verdiModus === "estimert"
        ? "Verdi i dag (estimert)"
        : "Verdi i dag (manuell)",
      roundKr(statusQuoTotals.effectiveVerdi),
    ],
    ["Estimert verdi (beregnet)", roundKr(statusQuoTotals.estimertVerdi)],
    ["Restgjeld", roundKr(statusQuoTotals.restgjeld)],
    ["Egenkapital i dag", roundKr(statusQuoTotals.egenkapital)],
    ["Salgskostnader", roundKr(statusQuo.salgskostnader)],
    ["Netto fra salg", roundKr(statusQuoTotals.nettoFraSalg)],
  ];

  if (statusQuo.dokumentavgiftAktivert) {
    rows.push(["Dokumentavgift ved kjøp", roundKr(statusQuoTotals.dokumentavgift)]);
    rows.push(["Total kjøpskostnad (historisk)", roundKr(statusQuoTotals.totalKjopskostnad)]);
  }

  appendSection(rows, "Ny bolig (kjøp og finansiering)", [
    ["Post", "Beløp (kr)"],
    ["Boligpris", roundKr(nyBolig.boligpris)],
    ["Egenkapital fra salg", roundKr(nyBoligTotals.egenkapitalFraSalg)],
    ["Ekstra kontanter til egenkapital", roundKr(nyBoligTotals.kontanterEgenkapital)],
    ["Total egenkapital (mot boligpris)", roundKr(nyBoligTotals.totalEgenkapital)],
    ["Nytt lånebehov", roundKr(nyBoligTotals.laan)],
    ["Dokumentavgift", roundKr(nyBoligTotals.dokumentavgift)],
    ["Flyttekostnader", roundKr(nyBoligTotals.flyttekostnader)],
    ["Tiltak (tilstandsrapport)", roundKr(nyBoligTotals.engangsTiltakTilstand)],
    ["Sum engangskostnader ved kjøp", roundKr(nyBoligTotals.engangskostnader)],
    ["Kontanter fra egen lomme (ekstra + engang)", roundKr(nyBoligTotals.kontanterFraLomme)],
  ]);

  if (nyBolig.utleieAktivert) {
    appendSection(rows, "Utleie (ny bolig)", [
      ["Post", "Beløp (kr)"],
      ["Netto utleie per måned", roundKr(nyBoligTotals.utleie.nettoInntektMnd)],
      ["Ekstra utgifter utleie (år)", roundKr(nyBoligTotals.utleie.ekstraKostnaderAar)],
      ["Estimert skatt utleie (år)", roundKr(nyBoligTotals.utleie.skattAar)],
      ["Faktisk kostnad per måned (etter utleie)", roundKr(nyBoligTotals.monthlyNetCost)],
    ]);
  }

  const tiltak = nyBolig.tilstandsTiltak ?? statusQuo.tilstandsTiltak ?? [];
  if (tiltak.length > 0) {
    appendSection(rows, "Tiltak fra tilstandsrapport", [
      ["Område", "TG", "Beløp (kr)", "Beskrivelse"],
      ...tiltak.map((item) => [
        item.omrade,
        item.tg != null ? `TG${item.tg}` : "",
        roundKr(item.belop),
        item.beskrivelse ?? "",
      ]),
    ]);
  }

  return rows;
}

function autoColumnWidths(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      const length = String(cell ?? "").length;
      widths[index] = Math.max(widths[index] ?? 10, Math.min(length + 2, 48));
    });
  }
  return widths.map((wch) => ({ wch }));
}

function sheetFromRows(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = autoColumnWidths(rows);
  return sheet;
}

export function exportExcelReport(data) {
  const workbook = XLSX.utils.book_new();

  const costRows = buildCostComparisonSheet(data);
  const capitalRows = buildCapitalSheet(data);

  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(costRows),
    "Kostnadssammenligning",
  );
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(capitalRows), "Flyttekapital");

  const filename = `boligkostnader-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
