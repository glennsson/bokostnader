const MONTHS = 12;

/**
 * Likviditetsbudsjett over flere år med vedlikeholdstopp og rentefradrag.
 */
export function buildLiquidityCashFlow({
  years = 10,
  monthlyOperatingCost = 0,
  monthlyLoanPayment = 0,
  maintenancePlan = [],
  inflasjonProsent = 2.5,
  rentefradragSats = 0.22,
  umiddelbarKapital = 0,
}) {
  const inflasjon = inflasjonProsent / 100;
  const rentefradrag = rentefradragSats;

  const rows = [];
  let kumulativ = -umiddelbarKapital;

  for (let year = 0; year <= years; year += 1) {
    const inflasjonFaktor = (1 + inflasjon) ** year;
    const driftAar = monthlyOperatingCost * MONTHS * inflasjonFaktor;
    const laanAar = monthlyLoanPayment * MONTHS;
    const rentefradragAar = laanAar * rentefradrag;

    const vedlikeholdAar = maintenancePlan
      .filter((item) => (item.planlagtAar ?? 0) === year)
      .reduce((sum, item) => sum + (Number(item.belop) || 0), 0);

    const utgifterAar = driftAar + laanAar + vedlikeholdAar - rentefradragAar;
    const nettoAar = year === 0 ? -umiddelbarKapital - utgifterAar : -utgifterAar;
    kumulativ += nettoAar;

    rows.push({
      year,
      label: year === 0 ? "I dag" : `År ${year}`,
      drift: Math.round(driftAar),
      laan: Math.round(laanAar),
      vedlikehold: Math.round(vedlikeholdAar),
      rentefradrag: Math.round(rentefradragAar),
      netto: Math.round(nettoAar),
      kumulativ: Math.round(kumulativ),
    });
  }

  const maxAbs = Math.max(
    ...rows.map((r) => Math.abs(r.netto)),
    umiddelbarKapital,
    1,
  );

  return {
    years,
    rows,
    maxAbs,
    totalVedlikehold: maintenancePlan.reduce(
      (s, i) => s + (Number(i.belop) || 0),
      0,
    ),
    umiddelbarKapital,
  };
}
