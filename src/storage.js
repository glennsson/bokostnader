const STORAGE_KEY = "bokostnader-kalkulator-v1";

export function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSavedState(payload) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function buildSavePayload({
  activeTab,
  statusQuo,
  nyBolig,
  forms,
  nextId,
  statusQuoTotals,
  nyBoligMonthly,
  nyBoligYearly,
  nyBoligTotals,
  formResults,
}) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    activeTab,
    statusQuo,
    nyBolig,
    forms,
    nextId,
    lagredeResultater: {
      statusQuo: {
        adresse: statusQuo.adresse ?? "",
        navn: statusQuo.name,
        maanedlig: statusQuoTotals.monthlyTotal,
        aarlig: statusQuoTotals.yearlyTotal,
        nettoFraSalg: statusQuoTotals.nettoFraSalg,
        egenkapital: statusQuoTotals.egenkapital,
      },
      nyBolig: {
        adresse: nyBolig.adresse ?? "",
        navn: nyBolig.name,
        maanedlig: nyBoligMonthly,
        aarlig: nyBoligYearly,
        laan: nyBoligTotals?.laan,
      },
      boformer: formResults.map((result) => {
        const form = forms.find((item) => item.id === result.id);
        return {
          id: result.id,
          adresse: form?.adresse ?? "",
          navn: result.name,
          maanedlig: result.totals.monthlyTotal,
          aarlig: result.totals.yearlyTotal,
        };
      }),
    },
  };
}
