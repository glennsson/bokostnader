import { parseSalgsoppgaveText, sanitizeListingCosts } from "../lib/salgsoppgave-parse.js";

const samples = [
  {
    name: "driftskostnadstabell",
    text:
      "Driftskostnader Forsikring 12 000 Strøm og varme 28 000 Kommunale avgifter 17 818 Vedlikehold 21 831 Sum driftskostnader 79 649",
    expect: { driftAarlig: 40_000, kommunaleAarlig: 17_818, vedlikeholdAarlig: 21_831 },
  },
  {
    name: "feil kommunale høyere enn drift",
    text: "Sum driftskostnader 79 649 Kommunale avgifter 178 180",
    expect: { driftAarlig: 79_649, kommunaleAarlig: null },
  },
  {
    name: "FINN kommunale avg per år",
    text: "Prisantydning6 200 000 kr Kommunale avg. 19 299 kr per år",
    expect: { boligpris: 6_200_000, kommunaleAarlig: 19_299 },
  },
  {
    name: "FINN boareal og kjøpspris",
    text: "Kjøpspris 4 200 000 kr Primærrom137 m² Bruksareal137 m²",
    expect: { kjopspris: 4_200_000, boarealKvm: 137 },
  },
];

for (const { name, text, expect } of samples) {
  const r = parseSalgsoppgaveText(text);
  console.log("\n===", name, "===", r);

  for (const [key, wanted] of Object.entries(expect)) {
    if (r[key] !== wanted) {
      console.error(`FEIL ${key}: ${r[key]} !== ${wanted}`);
      process.exitCode = 1;
    }
  }
}
