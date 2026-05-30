import { parseTilstandsrapportText } from "../lib/tilstandsrapport-parse.js";

const samples = [
  {
    name: "gnr/bnr + duplikat balkong + milliard total",
    text:
      "Eiendom gnr. 382 bnr. 470375 Balkong TG2 85000 kr Balkonger TG2 85000 kr Balkong TG2 85000 kr Våtrom TG3 250000 kr Samlet kostnadsestimat 48000000000 kr",
  },
  {
    name: "TG2 uten mellomrom",
    text:
      "Tilstandsrapport for bolig. Balkong TG2 85000 kr Tak TG2 120000 kr Elektrisk anlegg TG3 45000 kr.",
  },
];

for (const { name, text } of samples) {
  const r = parseTilstandsrapportText(text);
  console.log("\n===", name, "===");
  console.log(
    JSON.stringify(
      {
        tiltak: r.tiltak.length,
        plan: r.maintenancePlan?.length,
        planLabels: r.maintenancePlan?.map(
          (m) => `${m.omrade} om ${m.planlagtAar} år (${m.belop})`,
        ),
        belopTypes: r.tiltak.map((t) => typeof t.belop),
        sumNodvendig: r.sumNodvendig,
        sumTotal: r.sumTotal,
        sumUmiddelbar: r.sumUmiddelbar,
      },
      null,
      2,
    ),
  );
}
