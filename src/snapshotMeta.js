/** Utleder visningsnavn og total månedssum fra lagret kalkulator-payload. */
export function getSnapshotMeta(payload) {
  if (!payload) {
    return { navn: "Uten navn", totalMaanedlig: 0 };
  }

  const lr = payload.lagredeResultater;

  if (payload.activeTab === "boformer" && Array.isArray(lr?.boformer) && lr.boformer.length > 0) {
    const sorted = [...lr.boformer].sort((a, b) => a.maanedlig - b.maanedlig);
    const primary = sorted[0];
    const totalMaanedlig = lr.boformer.reduce((sum, item) => sum + (item.maanedlig ?? 0), 0);
    return {
      navn: primary.adresse?.trim() || primary.navn || "Sammenligning boformer",
      totalMaanedlig,
    };
  }

  if (lr?.nyBolig) {
    const navn =
      lr.nyBolig.adresse?.trim() ||
      lr.nyBolig.navn ||
      lr.statusQuo?.adresse?.trim() ||
      lr.statusQuo?.navn ||
      "Flyttesammenligning";
    return {
      navn,
      totalMaanedlig: lr.nyBolig.maanedlig ?? 0,
    };
  }

  if (lr?.statusQuo) {
    return {
      navn: lr.statusQuo.adresse?.trim() || lr.statusQuo.navn || "Nåværende bolig",
      totalMaanedlig: lr.statusQuo.maanedlig ?? 0,
    };
  }

  return { navn: "Kalkulator", totalMaanedlig: 0 };
}
