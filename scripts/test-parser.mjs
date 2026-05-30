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
    expect: { sumTotal: 250_000, belop: [85_000, 120_000, 45_000] },
  },
  {
    name: "drenering duplikat (side 5 + sammendrag)",
    text:
      "Drenering TG2 300000 kr Utbedring av drenering anbefales. Sammendrag: Drenering TG2 300000 kr Samlet kostnadsestimat 600000 kr",
  },
  {
    name: "like beløp ulike områdetekster",
    text:
      "Innvendig overflate TG2 10000 kr Overflater TG2 10000 kr Rom under terreng TG2 3600 kr Kjeller TG2 3600 kr",
    expect: { sumTotal: 13_600, belop: [3600, 10_000] },
  },
  {
    name: "rapport-frase (ikke bygningsdel)",
    text: "Slike anslag gis for TG3 20000 kr Tak TG2 85000 kr",
    expect: { sumTotal: 85_000, belop: [85_000] },
  },
  {
    name: "salgsoppgave kun intervallestimat",
    text:
      "Innvendige overflater TG2 MINDRE AVVIK TILSTANDSGRAD 2 Slike anslag gis for utbedringstiltak. Kostnadsestimat 20 000 - 100 000 kr.",
    expect: { sumTotal: 100_000, belop: [100_000], tiltakCount: 1 },
  },
  {
    name: "konsekvens/tiltak fukt uten kr",
    text:
      "Rom under terreng TG3 Konsekvens/tiltak • Tiltak: Konsekvens: Ved vedvarende fuktpåvirkning er det økt risiko for utvikling av muggsopp, råteskader og redusert inneklima. Skjulte konstruksjoner kan være påvirket uten at dette er verifisert. Tiltak: Årsak til fukt må kartlegges nærmere (f.eks. kondens, innsig eller utilstrekkelig drenering/isolasjon). Det anbefales målinger og eventuell åpning av konstruksjon ved behov. Nødvendige tiltak utføres basert på funn. Kostnadsestimat: 20 000 - 100 000",
    expect: {
      sumTotal: 100_000,
      belop: [100_000],
      tiltakCount: 1,
      omradeIncludes: "Drenering",
    },
  },
  {
    name: "kostnadsestimat enkeltbeløp",
    text: "Våtrom TG3 Tiltak: Bytte membran og sluk. Kostnadsestimat: 85 000",
    expect: { sumTotal: 85_000, belop: [85_000], tiltakCount: 1 },
  },
  {
    name: "flere kostnadsestimat",
    text:
      "Tak TG2 Tiltak: Legge om takstein. Kostnadsestimat: 120 000 Balkong TG2 Tiltak: Utskifting av rekkverk. Kostnadsestimat: 45 000",
    expect: { sumTotal: 165_000, belop: [45_000, 120_000], tiltakCount: 2 },
  },
];

for (const { name, text, expect } of samples) {
  const r = parseTilstandsrapportText(text);
  console.log("\n===", name, "===");
  console.log(
    JSON.stringify(
      {
        tiltak: r.tiltak.length,
        belop: r.tiltak.map((t) => t.belop),
        omrader: r.tiltak.map((t) => t.kategori ?? t.omrade),
        beskrivelse: r.tiltak.map((t) => t.beskrivelse?.slice(0, 60)),
        planLabels: r.maintenancePlan?.map(
          (m) => `${m.omrade} om ${m.planlagtAar} år (${m.belop})`,
        ),
        sumNodvendig: r.sumNodvendig,
        sumTotal: r.sumTotal,
        sumUmiddelbar: r.sumUmiddelbar,
      },
      null,
      2,
    ),
  );

  if (expect?.sumTotal != null && r.sumTotal !== expect.sumTotal) {
    console.error(`FEIL: sumTotal ${r.sumTotal} !== forventet ${expect.sumTotal}`);
    process.exitCode = 1;
  }
  if (expect?.tiltakCount != null && r.tiltak.length !== expect.tiltakCount) {
    console.error(`FEIL: tiltak ${r.tiltak.length} !== forventet ${expect.tiltakCount}`);
    process.exitCode = 1;
  }
  if (expect?.omradeIncludes) {
    const labels = r.tiltak.map((t) => `${t.kategori ?? ""} ${t.omrade ?? ""}`).join(" ");
    if (!labels.toLowerCase().includes(expect.omradeIncludes.toLowerCase())) {
      console.error(`FEIL: fant ikke område med «${expect.omradeIncludes}» i ${labels}`);
      process.exitCode = 1;
    }
  }
  if (expect?.belop) {
    const got = [...r.tiltak.map((t) => t.belop)].sort((a, b) => a - b);
    const wanted = [...expect.belop].sort((a, b) => a - b);
    if (JSON.stringify(got) !== JSON.stringify(wanted)) {
      console.error(`FEIL: belop ${got} !== forventet ${wanted}`);
      process.exitCode = 1;
    }
  }
}
