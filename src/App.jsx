import React, { useCallback, useEffect, useMemo, useState } from "react";
import AuthPanel from "./AuthPanel";
import Dashboard from "./Dashboard";
import SavedSimulationsPanel from "./SavedSimulationsPanel";
import TilstandsrapportPanel, { applyTilstandsrapportToHome } from "./TilstandsrapportPanel";
import {
  deleteCloudState,
  getSessionUser,
  formatSupabaseError,
  loadCloudState,
  saveCloudSnapshot,
  saveToSupabase,
  subscribeToAuth,
} from "./cloudStorage";
import { saveScenarioToCloud, upsertPropertyFromFinn } from "./propertyCloud";
import { getSnapshotMeta } from "./snapshotMeta";
import { buildShareUrl, readShareFromUrl } from "./share";
import { extractStateFromPayload } from "./savedState";
import { isCloudEnabled } from "./supabaseClient";
import {
  buildSavePayload,
  clearSavedState,
  loadSavedState,
  saveSavedState,
} from "./storage";
import { exportExcelReport } from "./exportExcel";
import BarChart, { monthlyCostChartItem } from "./BarChart";
import CashFlowChart from "./CashFlowChart";
import { buildLiquidityCashFlow } from "../lib/cashflow-scenario.js";
import { applyThemeToDocument, getInitialTheme, THEME_STORAGE_KEY } from "./theme";
import {
  estimateBoligverdi,
  getKommuneRate,
  KOMMUNER,
  calculateVerdistigning,
} from "../lib/verdiestimat.js";

const MONTHS_PER_YEAR = 12;

const defaultForms = [
  {
    id: 1,
    name: "Enebolig",
    adresse: "",
    boligpris: 5500000,
    egenkapital: 1100000,
    rente: 5.2,
    nedbetalingstid: 25,
    driftAarlig: 38000,
    kommunaleAarlig: 22000,
    vedlikeholdAarlig: 28000,
    felleskostnaderMnd: 0,
  },
  {
    id: 2,
    name: "Rekkehus",
    adresse: "",
    boligpris: 4300000,
    egenkapital: 860000,
    rente: 5.2,
    nedbetalingstid: 25,
    driftAarlig: 26000,
    kommunaleAarlig: 17000,
    vedlikeholdAarlig: 18000,
    felleskostnaderMnd: 2500,
  },
];

const emptyForm = {
  name: "",
  adresse: "",
  boligpris: 0,
  egenkapital: 0,
  rente: 0,
  nedbetalingstid: 25,
  driftAarlig: 0,
  kommunaleAarlig: 0,
  vedlikeholdAarlig: 0,
  felleskostnaderMnd: 0,
};

function asCurrency(value) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value);
}

function differenceClassName(value) {
  if (value > 0) {
    return "difference difference-negative";
  }
  if (value < 0) {
    return "difference difference-positive";
  }
  return "difference difference-neutral";
}

function readNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function yearsSinceOvertakelse(overtakelsesdato) {
  if (!overtakelsesdato) {
    return 0;
  }

  const start = new Date(overtakelsesdato);
  if (Number.isNaN(start.getTime())) {
    return 0;
  }

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(0, diffMs / (365.25 * 24 * 60 * 60 * 1000));
}

function formatDateNb(isoDate) {
  if (!isoDate) {
    return "";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat("nb-NO").format(date);
}

function calculateMonthlyPayment(principal, annualRatePercent, termYears) {
  const monthlyPayments = termYears * MONTHS_PER_YEAR;
  if (principal <= 0 || monthlyPayments <= 0) {
    return 0;
  }

  const monthlyRate = annualRatePercent / 100 / MONTHS_PER_YEAR;
  if (monthlyRate === 0) {
    return principal / monthlyPayments;
  }

  const compound = (1 + monthlyRate) ** monthlyPayments;
  return principal * ((monthlyRate * compound) / (compound - 1));
}

function remainingLoanBalance(principal, annualRatePercent, termYears, yearsPaid) {
  const totalMonths = termYears * MONTHS_PER_YEAR;
  const paidMonths = Math.min(yearsPaid * MONTHS_PER_YEAR, totalMonths);

  if (principal <= 0 || paidMonths <= 0) {
    return principal;
  }
  if (paidMonths >= totalMonths) {
    return 0;
  }

  const monthlyRate = annualRatePercent / 100 / MONTHS_PER_YEAR;
  if (monthlyRate === 0) {
    return Math.max(0, principal * (1 - paidMonths / totalMonths));
  }

  const compoundTotal = (1 + monthlyRate) ** totalMonths;
  const compoundPaid = (1 + monthlyRate) ** paidMonths;
  return Math.max(0, (principal * (compoundTotal - compoundPaid)) / (compoundTotal - 1));
}

function calculateOperatingCosts(form) {
  const yearlyRunningCosts =
    form.driftAarlig + form.kommunaleAarlig + form.vedlikeholdAarlig;
  const monthlyRunningCosts = yearlyRunningCosts / MONTHS_PER_YEAR;
  return {
    yearlyRunningCosts,
    monthlyRunningCosts,
    monthlyTotal: monthlyRunningCosts + form.felleskostnaderMnd,
  };
}

function calculateCosts(form) {
  const principal = Math.max(0, form.boligpris - form.egenkapital);
  const monthlyLoanCost = calculateMonthlyPayment(
    principal,
    form.rente,
    form.nedbetalingstid,
  );
  const operating = calculateOperatingCosts(form);
  const monthlyTotal = monthlyLoanCost + operating.monthlyTotal;

  return {
    principal,
    monthlyLoanCost,
    yearlyRunningCosts: operating.yearlyRunningCosts,
    monthlyTotal,
    yearlyTotal: monthlyTotal * MONTHS_PER_YEAR,
  };
}

const defaultStatusQuo = {
  name: "Nåværende bolig",
  adresse: "",
  overtakelsesdato: "2021-05-28",
  kjopspris: 4200000,
  egenkapitalVedKjop: 840000,
  verdiIDag: 5200000,
  verdiModus: "manuell",
  kommune: "oslo",
  boarealKvm: 85,
  verdistigningAarlig: 5.5,
  restgjeld: 0,
  rente: 4.8,
  nedbetalingstid: 25,
  driftAarlig: 32000,
  kommunaleAarlig: 20000,
  vedlikeholdAarlig: 22000,
  felleskostnaderMnd: 0,
  salgskostnader: 150000,
  dokumentavgiftProsent: 2.5,
  dokumentavgiftAktivert: false,
  tilstandsTiltak: [],
  maintenancePlan: [],
  engangsTiltakTilstand: 0,
  tilstandsrapportUrl: "",
  propertyId: null,
  likviditetAar: 10,
  likviditetInflasjon: 2.5,
};

const defaultNyBolig = {
  name: "Ny bolig",
  adresse: "",
  boligpris: 5800000,
  kontanterEgenkapital: 200000,
  rente: 5.2,
  nedbetalingstid: 25,
  driftAarlig: 36000,
  kommunaleAarlig: 24000,
  vedlikeholdAarlig: 30000,
  felleskostnaderMnd: 0,
  flyttekostnader: 80000,
  dokumentavgiftProsent: 2.5,
  dokumentavgiftAktivert: true,
  utleieAktivert: false,
  utleieInntektMnd: 0,
  skattefriGrenseAar: 20000,
  skattesatsProsent: 22,
  utleieEkstraForsikringAar: 3500,
  utleieEkstraSlitasjeProsent: 8,
  utleieEkstraStromVannAar: 6000,
  utleieEkstraAnnetAar: 2000,
  tilstandsTiltak: [],
  maintenancePlan: [],
  engangsTiltakTilstand: 0,
  tilstandsrapportUrl: "",
  propertyId: null,
  likviditetAar: 10,
  likviditetInflasjon: 2.5,
};

async function attachPropertyFromFinn(home, finnUrl, finnData, role) {
  try {
    const propertyId = await upsertPropertyFromFinn({
      finnUrl,
      finnData,
      adresse: home.adresse,
      role,
    });
    if (propertyId) {
      return { ...home, propertyId };
    }
  } catch {
    // properties-tabell kan mangle – import fortsetter lokalt
  }
  return home;
}

function calculateUtleie(nyBolig) {
  if (!nyBolig.utleieAktivert || nyBolig.utleieInntektMnd <= 0) {
    return {
      bruttoAar: 0,
      ekstraKostnaderAar: 0,
      skattAar: 0,
      skattefriDel: 0,
      nettoInntektMnd: 0,
    };
  }

  const bruttoAar = nyBolig.utleieInntektMnd * MONTHS_PER_YEAR;
  const slitasjeAar = bruttoAar * (nyBolig.utleieEkstraSlitasjeProsent / 100);
  const ekstraKostnaderAar =
    nyBolig.utleieEkstraForsikringAar +
    slitasjeAar +
    nyBolig.utleieEkstraStromVannAar +
    nyBolig.utleieEkstraAnnetAar;
  const skattefriDel = Math.min(bruttoAar, nyBolig.skattefriGrenseAar);
  const skattepliktig = Math.max(0, bruttoAar - nyBolig.skattefriGrenseAar);
  const skattAar = skattepliktig * (nyBolig.skattesatsProsent / 100);
  const nettoAar = bruttoAar - ekstraKostnaderAar - skattAar;

  return {
    bruttoAar,
    ekstraKostnaderAar,
    skattAar,
    skattefriDel,
    nettoInntektMnd: nettoAar / MONTHS_PER_YEAR,
  };
}

function applyListingCosts(next, data) {
  if (data.felleskostnaderMnd != null) next.felleskostnaderMnd = data.felleskostnaderMnd;
  if (data.kommunaleAarlig != null) next.kommunaleAarlig = data.kommunaleAarlig;
  if (data.vedlikeholdAarlig != null) next.vedlikeholdAarlig = data.vedlikeholdAarlig;
  if (data.driftAarlig != null) next.driftAarlig = data.driftAarlig;
  return next;
}

function applyListingImport(current, data) {
  const next = applyListingCosts({ ...current }, data);
  if (data.boligpris != null) next.boligpris = data.boligpris;
  if (
    data.utleieInntektMnd != null &&
    data.utleieInntektMnd > 0 &&
    Object.prototype.hasOwnProperty.call(current, "utleieAktivert")
  ) {
    next.utleieAktivert = true;
    next.utleieInntektMnd = data.utleieInntektMnd;
  }
  return next;
}

function applyListingToStatusQuo(statusQuo, data) {
  const next = applyListingCosts({ ...statusQuo }, data);
  if (data.boligpris != null) next.verdiIDag = data.boligpris;
  if (data.tilstandsrapport?.found) {
    return applyTilstandsrapportToHome(next, data.tilstandsrapport);
  }
  return next;
}

function applyListingToNyBolig(nyBolig, data) {
  const next = applyListingImport(nyBolig, data);
  if (data.tilstandsrapport?.found) {
    return applyTilstandsrapportToHome(next, data.tilstandsrapport);
  }
  return next;
}

async function fetchFinnListing(url) {
  const response = await fetch("/api/finn/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Kunne ikke hente data fra FINN.");
  }
  return data;
}

function describeImportSource(data) {
  if (data.hentetFra) {
    const utdatert = data.utdatert ? " (utgått annonse)" : "";
    return `${data.hentetFra}${utdatert}`;
  }

  const salgsoppgaveKilde =
    data.salgsoppgaveType === "pdf"
      ? "salgsoppgave (PDF)"
      : data.salgsoppgaveType === "html"
        ? "salgsoppgave (nettside)"
        : "salgsoppgave";
  if (data.salgsoppgaveFunnet) {
    return `${salgsoppgaveKilde} og FINN-side`;
  }
  if (data.funnet) {
    return data.utdatert ? "utgått FINN-side" : "FINN-side";
  }
  return "ingen gjenkjente tall";
}

function calculateDokumentavgift(home, prisGrunnlag) {
  if (!home.dokumentavgiftAktivert) {
    return 0;
  }
  return prisGrunnlag * (home.dokumentavgiftProsent / 100);
}

function calculateStatusQuo(statusQuo) {
  const aarBodd = yearsSinceOvertakelse(statusQuo.overtakelsesdato);

  const estimertVerdi = estimateBoligverdi({
    kjopspris: statusQuo.kjopspris,
    aarBodd,
    verdistigningAarlig: statusQuo.verdistigningAarlig,
    boarealKvm: statusQuo.boarealKvm,
  });
  const verdiModus = statusQuo.verdiModus === "estimert" ? "estimert" : "manuell";
  const effectiveVerdi = verdiModus === "estimert" ? estimertVerdi : statusQuo.verdiIDag;
  const verdistigning = calculateVerdistigning(statusQuo.kjopspris, effectiveVerdi);

  const laanVedKjop = Math.max(0, statusQuo.kjopspris - statusQuo.egenkapitalVedKjop);
  const beregnetRestgjeld = remainingLoanBalance(
    laanVedKjop,
    statusQuo.rente,
    statusQuo.nedbetalingstid,
    aarBodd,
  );
  const restgjeld =
    statusQuo.restgjeld > 0 ? statusQuo.restgjeld : beregnetRestgjeld;
  const gjenstaendeAar = Math.max(0, statusQuo.nedbetalingstid - aarBodd);
  const monthlyLoanCost = calculateMonthlyPayment(
    restgjeld,
    statusQuo.rente,
    Math.max(gjenstaendeAar, 1),
  );
  const operating = calculateOperatingCosts(statusQuo);
  const monthlyTotal = monthlyLoanCost + operating.monthlyTotal;
  const egenkapital = effectiveVerdi - restgjeld;
  const nettoFraSalg = effectiveVerdi - restgjeld - statusQuo.salgskostnader;
  const dokumentavgift = calculateDokumentavgift(statusQuo, statusQuo.kjopspris);
  const totalKjopskostnad = statusQuo.kjopspris + dokumentavgift;

  return {
    laanVedKjop,
    restgjeld,
    beregnetRestgjeld,
    gjenstaendeAar,
    monthlyLoanCost,
    yearlyRunningCosts: operating.yearlyRunningCosts,
    monthlyTotal,
    yearlyTotal: monthlyTotal * MONTHS_PER_YEAR,
    egenkapital,
    nettoFraSalg,
    estimertVerdi,
    effectiveVerdi,
    verdiModus,
    verdistigning,
    dokumentavgift,
    totalKjopskostnad,
    aarBodd,
    overtakelsesdato: statusQuo.overtakelsesdato,
  };
}

function calculateNyBolig(nyBolig, nettoFraSalg) {
  const egenkapitalFraSalg = Math.max(0, nettoFraSalg);
  const totalEgenkapital = egenkapitalFraSalg + nyBolig.kontanterEgenkapital;
  const laan = Math.max(0, nyBolig.boligpris - totalEgenkapital);
  const monthlyLoanCost = calculateMonthlyPayment(
    laan,
    nyBolig.rente,
    nyBolig.nedbetalingstid,
  );
  const operating = calculateOperatingCosts(nyBolig);
  const monthlyTotal = monthlyLoanCost + operating.monthlyTotal;
  const utleie = calculateUtleie(nyBolig);
  const monthlyNetCost = monthlyTotal - utleie.nettoInntektMnd;
  const dokumentavgift = calculateDokumentavgift(nyBolig, nyBolig.boligpris);
  const engangsTiltakTilstand = nyBolig.engangsTiltakTilstand ?? 0;
  const engangskostnader = nyBolig.flyttekostnader + dokumentavgift + engangsTiltakTilstand;
  const kontanterTilDokOgFlytt = engangskostnader;
  const kontanterFraLomme =
    nyBolig.kontanterEgenkapital + kontanterTilDokOgFlytt;

  return {
    egenkapitalFraSalg,
    kontanterEgenkapital: nyBolig.kontanterEgenkapital,
    totalEgenkapital,
    boligpris: nyBolig.boligpris,
    laan,
    kontanterTilDokOgFlytt,
    kontanterFraLomme,
    monthlyLoanCost,
    yearlyRunningCosts: operating.yearlyRunningCosts,
    monthlyTotal,
    yearlyTotal: monthlyTotal * MONTHS_PER_YEAR,
    monthlyNetCost,
    yearlyNetCost: monthlyNetCost * MONTHS_PER_YEAR,
    flyttekostnader: nyBolig.flyttekostnader,
    engangsTiltakTilstand,
    dokumentavgift,
    engangskostnader,
    utleie,
  };
}

function asNumber(value) {
  return Number(value.toFixed(0));
}

function buildCsv(forms, results) {
  const header = [
    "Boform",
    "Boligpris",
    "Egenkapital",
    "Laanebehov",
    "RenteProsent",
    "NedbetalingstidAar",
    "DriftAarlig",
    "KommunaleAarlig",
    "VedlikeholdAarlig",
    "FelleskostnaderMnd",
    "MaanedligLaanekostnad",
    "TotalMaanedlig",
    "TotalAarlig",
  ];

  const rows = results.map((result) => {
    const form = forms.find((item) => item.id === result.id);
    if (!form) {
      return [];
    }

    return [
      form.name,
      asNumber(form.boligpris),
      asNumber(form.egenkapital),
      asNumber(result.totals.principal),
      form.rente,
      form.nedbetalingstid,
      asNumber(form.driftAarlig),
      asNumber(form.kommunaleAarlig),
      asNumber(form.vedlikeholdAarlig),
      asNumber(form.felleskostnaderMnd),
      asNumber(result.totals.monthlyLoanCost),
      asNumber(result.totals.monthlyTotal),
      asNumber(result.totals.yearlyTotal),
    ];
  });

  const toLine = (columns) =>
    columns
      .map((column) => `"${String(column).replaceAll('"', '""')}"`)
      .join(";");

  return [toLine(header), ...rows.map(toLine)].join("\n");
}

function exportCsv(forms, results) {
  const csv = buildCsv(forms, results);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "boligkostnader-sammenligning.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportPdf(results) {
  const rows = results
    .map(
      (result) =>
        `<tr>
          <td>${result.name}</td>
          <td>${asCurrency(result.totals.monthlyTotal)}</td>
          <td>${asCurrency(result.totals.yearlyTotal)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
  <html lang="no">
    <head>
      <meta charset="UTF-8" />
      <title>Boligkostnader - PDF</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
        h1 { margin: 0 0 8px; }
        p { margin: 0 0 20px; color: #4b5563; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
        th { background: #f3f4f6; }
      </style>
    </head>
    <body>
      <h1>Oversikt over boligkostnader</h1>
      <p>Generert fra kalkulatoren.</p>
      <table>
        <thead>
          <tr>
            <th>Boform</th>
            <th>Total per måned</th>
            <th>Total per år</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`;

  const printWindow = window.open("", "_blank", "width=1000,height=800");
  if (!printWindow) {
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function CostInput({ label, value, onChange, step = 1000 }) {
  const [draft, setDraft] = useState(() => String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const commitValue = (raw) => {
    const parsed = readNumber(raw);
    onChange(parsed);
    setDraft(String(parsed));
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commitValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitValue(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function AddressInput({ value, onChange }) {
  return (
    <label className="field address-field">
      <span>Adresse</span>
      <input
        type="text"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder="f.eks. Storgata 1, 1400 Ski"
      />
    </label>
  );
}

function formatSavedTime(isoString) {
  if (!isoString) {
    return "";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function HousingCard({ title, item, fields, totals, onFieldChange, beforeGrid, children }) {
  return (
    <article className="card card-highlight">
      <h2>{title}</h2>
      <AddressInput
        value={item.adresse}
        onChange={(value) => onFieldChange("adresse", value)}
      />
      {beforeGrid}
      <div className="grid">
        {fields.map((field) =>
          field.type === "date" ? (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              <input
                type="date"
                value={item[field.key] ?? ""}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
              />
            </label>
          ) : (
            <CostInput
              key={field.key}
              label={field.label}
              value={item[field.key]}
              onChange={(value) => onFieldChange(field.key, value)}
              step={field.step ?? 1000}
            />
          ),
        )}
      </div>
      {children}
      <div className="result">{totals}</div>
    </article>
  );
}

const utleieFields = [
  { key: "utleieInntektMnd", label: "Brutto leieinntekt per måned (kr)" },
  { key: "skattefriGrenseAar", label: "Skattefri grense per år (kr)", step: 1000 },
  { key: "skattesatsProsent", label: "Skatt på overskudd (%)", step: 0.1 },
  { key: "utleieEkstraForsikringAar", label: "Ekstra forsikring utleie (kr/år)" },
  { key: "utleieEkstraSlitasjeProsent", label: "Slitasje/vedlikehold (% av leie)", step: 1 },
  { key: "utleieEkstraStromVannAar", label: "Strøm/vann andel (kr/år)" },
  { key: "utleieEkstraAnnetAar", label: "Annet (regnskap, fellesareal) (kr/år)" },
];

function FormCard({ item, onUpdate, onRemove, totals, canRemove }) {
  const updateField = (field, value) => {
    onUpdate(item.id, field, value);
  };

  return (
    <article className="card">
      <div className="card-header">
        <label className="field">
          <span>Boform</span>
          <input
            type="text"
            value={item.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Navn på boform"
          />
        </label>
        <button
          type="button"
          className="button button-danger"
          onClick={() => onRemove(item.id)}
          disabled={!canRemove}
        >
          Fjern
        </button>
      </div>

      <AddressInput
        value={item.adresse}
        onChange={(value) => updateField("adresse", value)}
      />

      <div className="grid">
        <CostInput
          label="Boligpris (kr)"
          value={item.boligpris}
          onChange={(value) => updateField("boligpris", value)}
        />
        <CostInput
          label="Egenkapital (kr)"
          value={item.egenkapital}
          onChange={(value) => updateField("egenkapital", value)}
        />
        <CostInput
          label="Rente (%)"
          value={item.rente}
          onChange={(value) => updateField("rente", value)}
          step={0.1}
        />
        <CostInput
          label="Nedbetalingstid (år)"
          value={item.nedbetalingstid}
          onChange={(value) => updateField("nedbetalingstid", value)}
          step={1}
        />
        <CostInput
          label="Driftskostnader årlig (kr)"
          value={item.driftAarlig}
          onChange={(value) => updateField("driftAarlig", value)}
        />
        <CostInput
          label="Kommunale avgifter årlig (kr)"
          value={item.kommunaleAarlig}
          onChange={(value) => updateField("kommunaleAarlig", value)}
        />
        <CostInput
          label="Vedlikehold årlig (kr)"
          value={item.vedlikeholdAarlig}
          onChange={(value) => updateField("vedlikeholdAarlig", value)}
        />
        <CostInput
          label="Felleskostnader per måned (kr)"
          value={item.felleskostnaderMnd}
          onChange={(value) => updateField("felleskostnaderMnd", value)}
        />
      </div>

      <div className="result">
        <p>
          Lånebehov: <strong>{asCurrency(totals.principal)}</strong>
        </p>
        <p>
          Månedlig lånekostnad: <strong>{asCurrency(totals.monthlyLoanCost)}</strong>
        </p>
        <p>
          Årlige driftskostnader: <strong>{asCurrency(totals.yearlyRunningCosts)}</strong>
        </p>
        <p>
          Total kostnad per måned: <strong>{asCurrency(totals.monthlyTotal)}</strong>
        </p>
        <p>
          Total kostnad per år: <strong>{asCurrency(totals.yearlyTotal)}</strong>
        </p>
      </div>
    </article>
  );
}

const statusQuoFields = [
  { key: "overtakelsesdato", label: "Overtakelsesdato", type: "date" },
  { key: "kjopspris", label: "Kjøpspris (kr)" },
  { key: "egenkapitalVedKjop", label: "Egenkapital ved kjøp (kr)" },
  { key: "boarealKvm", label: "Boareal (kvm)", step: 1 },
  { key: "restgjeld", label: "Restgjeld i dag (kr, 0 = auto)" },
  { key: "rente", label: "Rente på lån (%)", step: 0.1 },
  { key: "nedbetalingstid", label: "Opprinnelig lånetid (år)", step: 1 },
  { key: "salgskostnader", label: "Salgskostnader (kr)" },
  { key: "driftAarlig", label: "Driftskostnader årlig (kr)" },
  { key: "kommunaleAarlig", label: "Kommunale avgifter årlig (kr)" },
  { key: "vedlikeholdAarlig", label: "Vedlikehold årlig (kr)" },
  { key: "felleskostnaderMnd", label: "Felleskostnader per måned (kr)" },
];

const nyBoligFields = [
  { key: "boligpris", label: "Pris på ny bolig (kr)" },
  { key: "kontanterEgenkapital", label: "Ekstra kontanter til egenkapital (kr)" },
  { key: "rente", label: "Rente på nytt lån (%)", step: 0.1 },
  { key: "nedbetalingstid", label: "Nedbetalingstid (år)", step: 1 },
  { key: "dokumentavgiftProsent", label: "Dokumentavgift (%)", step: 0.1 },
  { key: "flyttekostnader", label: "Engangs flyttekostnader (kr)" },
  { key: "driftAarlig", label: "Driftskostnader årlig (kr)" },
  { key: "kommunaleAarlig", label: "Kommunale avgifter årlig (kr)" },
  { key: "vedlikeholdAarlig", label: "Vedlikehold årlig (kr)" },
  { key: "felleskostnaderMnd", label: "Felleskostnader per måned (kr)" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("flytt");
  const [forms, setForms] = useState(defaultForms);
  const [statusQuo, setStatusQuo] = useState(defaultStatusQuo);
  const [nyBolig, setNyBolig] = useState(defaultNyBolig);
  const [nextId, setNextId] = useState(3);
  const [finnUrl, setFinnUrl] = useState("");
  const [finnUrlNaa, setFinnUrlNaa] = useState("");
  const [finnUrlNy, setFinnUrlNy] = useState("");
  const [targetFormId, setTargetFormId] = useState(defaultForms[0].id);
  const [importStatus, setImportStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [pageView, setPageView] = useState("calculator");
  const [simulationsVersion, setSimulationsVersion] = useState(0);
  const [theme, setTheme] = useState(() => {
    const initial = getInitialTheme();
    applyThemeToDocument(initial);
    return initial;
  });

  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage utilgjengelig
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  const payloadDefaults = useMemo(
    () => ({ defaultStatusQuo, defaultNyBolig, emptyForm }),
    [],
  );

  const applySaved = useCallback(
    (saved, statusMessage) => {
      const state = extractStateFromPayload(saved, payloadDefaults);
      if (!state) {
        return;
      }

      if (state.activeTab) {
        setActiveTab(state.activeTab);
      }
      if (state.statusQuo) {
        setStatusQuo(state.statusQuo);
      }
      if (state.nyBolig) {
        setNyBolig(state.nyBolig);
      }
      if (state.forms) {
        setForms(state.forms);
      }
      if (state.nextId) {
        setNextId(state.nextId);
      }
      if (state.savedAt) {
        setLastSavedAt(state.savedAt);
      }
      if (statusMessage) {
        setSaveStatus(statusMessage);
      }
    },
    [payloadDefaults],
  );

  const persistPayload = useCallback(
    async (payload, statusMessage, { forceCloud = false } = {}) => {
      saveSavedState(payload);
      setLastSavedAt(payload.savedAt);

      if (!isCloudEnabled) {
        if (statusMessage) {
          setSaveStatus(statusMessage);
        }
        return;
      }

      try {
        const user = await getSessionUser();
        if (!user) {
          if (forceCloud || statusMessage) {
            setSaveStatus(
              statusMessage
                ? `${statusMessage} Ikke lagret i sky – logg inn med e-post.`
                : "Logg inn for å lagre i skyen.",
            );
          }
          return;
        }

        await saveToSupabase(payload);
        setSaveStatus(
          statusMessage
            ? `${statusMessage} Lagret i skyen.`
            : "Autolagret i skyen.",
        );
      } catch (error) {
        setSaveStatus(
          statusMessage
            ? `${statusMessage} ${formatSupabaseError(error)}`
            : formatSupabaseError(error),
        );
      }
    },
    [],
  );

  const bumpSimulationsList = useCallback(() => {
    setSimulationsVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const shared = readShareFromUrl();
      if (shared) {
        applySaved(shared, null);
        if (!cancelled) {
          setShareStatus("Data lastet fra delt lenke.");
          setHydrated(true);
        }
        return;
      }

      if (isCloudEnabled) {
        try {
          const user = await getSessionUser();
          if (!cancelled) {
            setAuthUser(user);
          }

          if (user) {
            const cloud = await loadCloudState();
            if (!cancelled && cloud) {
              applySaved(cloud, "Lastet fra skyen.");
              setHydrated(true);
              return;
            }
          }
        } catch (error) {
          if (!cancelled) {
            setSaveStatus(`Kunne ikke laste fra skyen: ${formatSupabaseError(error)}`);
          }
        }
      }

      const local = loadSavedState();
      if (!cancelled && local) {
        applySaved(local, "Lastet lagret kalkulator fra denne nettleseren.");
      }
      if (!cancelled) {
        setHydrated(true);
      }
    }

    init();

    const unsubscribe = subscribeToAuth(async (event, user) => {
      setAuthUser(user);

      if (event === "SIGNED_IN" && user) {
        bumpSimulationsList();
        try {
          const cloud = await loadCloudState();
          if (cloud) {
            applySaved(cloud, "Innlogget – data hentet fra skyen.");
            return;
          }

          const local = loadSavedState();
          if (local) {
            applySaved(local, null);
            await saveToSupabase(local);
            setSaveStatus("Innlogget – lokal kalkulator er lastet opp til skyen.");
          } else {
            setSaveStatus(
              "Innlogget – ingen data i skyen ennå. Endre et tall eller trykk «Lagre nå» for å lagre.",
            );
          }
        } catch (error) {
          setSaveStatus(`Innlogget, men sky-lagring feilet: ${formatSupabaseError(error)}`);
        }
      }

      if (event === "SIGNED_OUT") {
        bumpSimulationsList();
        setSaveStatus("Utlogget. Data lagres lokalt i nettleseren.");
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applySaved, bumpSimulationsList]);

  const statusQuoTotals = useMemo(() => calculateStatusQuo(statusQuo), [statusQuo]);
  const nyBoligTotals = useMemo(
    () => calculateNyBolig(nyBolig, statusQuoTotals.nettoFraSalg),
    [nyBolig, statusQuoTotals.nettoFraSalg],
  );

  const nyBoligCostMonthly = nyBolig.utleieAktivert
    ? nyBoligTotals.monthlyNetCost
    : nyBoligTotals.monthlyTotal;
  const nyBoligCostYearly = nyBolig.utleieAktivert
    ? nyBoligTotals.yearlyNetCost
    : nyBoligTotals.yearlyTotal;

  const moveDeltaMonthly = nyBoligCostMonthly - statusQuoTotals.monthlyTotal;
  const moveDeltaYearly = nyBoligCostYearly - statusQuoTotals.yearlyTotal;

  const setVerdiModus = (modus) => {
    setStatusQuo((current) => ({ ...current, verdiModus: modus }));
    setShareStatus(
      modus === "estimert"
        ? "Beregninger bruker estimert prisstigning."
        : "Beregninger bruker manuell verdi i dag.",
    );
  };

  const copyShareLink = async () => {
    const url = buildShareUrl({
      activeTab,
      statusQuo,
      nyBolig,
      forms,
      nextId,
    });

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("Delbar lenke kopiert til utklippstavlen.");
    } catch {
      setShareStatus(`Kunne ikke kopiere automatisk. Lim inn denne lenken: ${url}`);
    }
  };

  const results = useMemo(
    () =>
      forms.map((form) => ({
        id: form.id,
        name: form.name,
        adresse: form.adresse,
        totals: calculateCosts(form),
      })),
    [forms],
  );

  const handleExportExcel = () => {
    exportExcelReport({
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
    });
    setShareStatus("Excel-rapport lastet ned.");
  };

  const openSavedCalculation = useCallback(
    (payload) => {
      applySaved(payload, "Kalkulator lastet fra oversikten.");
      setPageView("calculator");
    },
    [applySaved],
  );

  const saveNow = () => {
    const payload = buildSavePayload({
      activeTab,
      statusQuo,
      nyBolig,
      forms,
      nextId,
      statusQuoTotals,
      nyBoligMonthly: nyBoligCostMonthly,
      nyBoligYearly: nyBoligCostYearly,
      nyBoligTotals,
      formResults: results,
    });

    void (async () => {
      await persistPayload(payload, "Kalkulator lagret med adresser og resultater.", {
        forceCloud: true,
      });
      if (isCloudEnabled) {
        try {
          const user = await getSessionUser();
          if (user) {
            const snapshotId = await saveCloudSnapshot(payload);
            const meta = getSnapshotMeta(payload);
            const propertyId = nyBolig.propertyId ?? statusQuo.propertyId ?? null;
            const scenarioId = await saveScenarioToCloud({
              navn: meta.navn,
              payload,
              propertyId,
            });
            if (snapshotId && scenarioId) {
              setSaveStatus(
                "Lagret i skyen (historikk + scenario + eiendom).",
              );
            } else if (snapshotId) {
              setSaveStatus("Lagret i skyen og lagt til i «Mine lagringer».");
            } else if (scenarioId) {
              setSaveStatus("Lagret i skyen (scenario).");
            }
          }
        } catch (error) {
          setSaveStatus(
            `Lagret i skyen. Historikk-rad feilet: ${formatSupabaseError(error)}`,
          );
        }
      }
      bumpSimulationsList();
    })();
  };

  const resetSaved = async () => {
    clearSavedState();
    setLastSavedAt(null);

    if (authUser && isCloudEnabled) {
      try {
        await deleteCloudState();
        setSaveStatus("Lagret data er slettet fra nettleseren og skyen.");
      } catch {
        setSaveStatus("Lokal data slettet. Kunne ikke slette fra skyen.");
      }
      return;
    }

    setSaveStatus("Lagret data er slettet fra nettleseren.");
    bumpSimulationsList();
  };

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const payload = buildSavePayload({
      activeTab,
      statusQuo,
      nyBolig,
      forms,
      nextId,
      statusQuoTotals,
      nyBoligMonthly: nyBoligCostMonthly,
      nyBoligYearly: nyBoligCostYearly,
      nyBoligTotals,
      formResults: results,
    });

    const timer = setTimeout(() => {
      void persistPayload(payload, null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    hydrated,
    activeTab,
    statusQuo,
    nyBolig,
    forms,
    nextId,
    statusQuoTotals,
    nyBoligCostMonthly,
    nyBoligCostYearly,
    nyBoligTotals,
    results,
    persistPayload,
  ]);

  const updateForm = (id, field, value) => {
    setForms((current) =>
      current.map((form) => (form.id === id ? { ...form, [field]: value } : form)),
    );
  };

  const addForm = () => {
    setForms((current) => [
      ...current,
      {
        ...emptyForm,
        id: nextId,
        name: `Boform ${current.length + 1}`,
      },
    ]);
    setNextId((current) => current + 1);
  };

  const removeForm = (id) => {
    setForms((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((form) => form.id !== id);
    });
  };

  const importFromFinn = async () => {
    if (!finnUrl.trim()) {
      setImportStatus("Legg inn en FINN-url først.");
      return;
    }

    setIsImporting(true);
    setImportStatus("Henter annonse...");

    try {
      const data = await fetchFinnListing(finnUrl);
      let cloudNote = "";
      let importedForm = null;

      setForms((current) =>
        current.map((form) => {
          if (form.id !== effectiveTargetFormId) {
            return form;
          }
          importedForm = applyListingImport(form, data);
          return importedForm;
        }),
      );

      if (importedForm) {
        const withProperty = await attachPropertyFromFinn(
          importedForm,
          finnUrl,
          data,
          "boform",
        );
        if (withProperty.propertyId) {
          setForms((current) =>
            current.map((form) =>
              form.id === effectiveTargetFormId ? withProperty : form,
            ),
          );
          cloudNote = " Eiendom lagret i skyen.";
        }
      }

      setImportStatus(
        data.funnet
          ? `Importert fra ${describeImportSource(data)}.${cloudNote} Sjekk og juster tallene.`
          : `Fant ingen tall automatisk.${cloudNote}`,
      );
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Noe gikk galt ved import.");
    } finally {
      setIsImporting(false);
    }
  };

  const importFlyttFromFinn = async (target) => {
    const url =
      target === "naa" ? finnUrlNaa.trim() : target === "ny" ? finnUrlNy.trim() : "";
    if (!url) {
      setImportStatus("Legg inn FINN-url for boligen du vil hente.");
      return;
    }

    const label = target === "naa" ? "Nåværende bolig" : "Ny bolig";
    setIsImporting(true);
    setImportStatus(`Henter ${label.toLowerCase()}...`);

    try {
      const data = await fetchFinnListing(url);
      let cloudNote = "";
      if (target === "naa") {
        const next = applyListingToStatusQuo(statusQuo, data);
        const withProperty = await attachPropertyFromFinn(next, url, data, "statusQuo");
        setStatusQuo(withProperty);
        if (withProperty.propertyId) {
          cloudNote = " Eiendom lagret i skyen.";
        }
      } else {
        const next = applyListingToNyBolig(nyBolig, data);
        const withProperty = await attachPropertyFromFinn(next, url, data, "nyBolig");
        setNyBolig(withProperty);
        if (withProperty.propertyId) {
          cloudNote = " Eiendom lagret i skyen.";
        }
      }
      const tilstandMsg = data.tilstandsrapportFunnet
        ? " Tilstandsrapport: tiltak hentet."
        : "";
      setImportStatus(
        data.funnet
          ? `${label}: importert fra ${describeImportSource(data)}.${tilstandMsg}${cloudNote}`
          : `${label}: fant ingen tall automatisk.${tilstandMsg}${cloudNote}`,
      );
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Noe gikk galt ved import.");
    } finally {
      setIsImporting(false);
    }
  };

  const importBothFlyttFromFinn = async () => {
    const hasNaa = Boolean(finnUrlNaa.trim());
    const hasNy = Boolean(finnUrlNy.trim());

    if (!hasNaa && !hasNy) {
      setImportStatus("Legg inn minst én FINN-url (gjerne begge).");
      return;
    }

    setIsImporting(true);
    setImportStatus("Henter annonser...");

    try {
      const messages = [];
      let updatedStatusQuo = statusQuo;
      let updatedNyBolig = nyBolig;

      if (hasNaa) {
        const dataNaa = await fetchFinnListing(finnUrlNaa);
        updatedStatusQuo = await attachPropertyFromFinn(
          applyListingToStatusQuo(updatedStatusQuo, dataNaa),
          finnUrlNaa,
          dataNaa,
          "statusQuo",
        );
        messages.push(
          dataNaa.funnet
            ? `Nåværende bolig: ${describeImportSource(dataNaa)}${dataNaa.tilstandsrapportFunnet ? " + tilstandsrapport" : ""}${updatedStatusQuo.propertyId ? " · sky" : ""}`
            : "Nåværende bolig: ingen gjenkjente tall",
        );
      }

      if (hasNy) {
        const dataNy = await fetchFinnListing(finnUrlNy);
        updatedNyBolig = await attachPropertyFromFinn(
          applyListingToNyBolig(updatedNyBolig, dataNy),
          finnUrlNy,
          dataNy,
          "nyBolig",
        );
        messages.push(
          dataNy.funnet
            ? `Ny bolig: ${describeImportSource(dataNy)}${dataNy.tilstandsrapportFunnet ? " + tilstandsrapport" : ""}${updatedNyBolig.propertyId ? " · sky" : ""}`
            : "Ny bolig: ingen gjenkjente tall",
        );
      }

      setStatusQuo(updatedStatusQuo);
      setNyBolig(updatedNyBolig);
      setImportStatus(`${messages.join(" · ")}. Sjekk og juster tallene.`);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Noe gikk galt ved import.");
    } finally {
      setIsImporting(false);
    }
  };

  const selectableForms = forms.map((form) => ({
    id: form.id,
    name: form.name.trim() || `Boform ${form.id}`,
  }));

  const targetExists = forms.some((form) => form.id === targetFormId);
  const effectiveTargetFormId = targetExists ? targetFormId : forms[0]?.id;

  const baseline = results[0];
  const sortedResults = [...results].sort(
    (a, b) => a.totals.monthlyTotal - b.totals.monthlyTotal,
  );

  const boformerChartItems = useMemo(
    () =>
      sortedResults.map((result) =>
        monthlyCostChartItem(result, { highlight: baseline?.id === result.id }),
      ),
    [sortedResults, baseline?.id],
  );

  const flyttChartItems = useMemo(
    () => [
      monthlyCostChartItem({
        id: "status-quo",
        name: statusQuo.adresse?.trim() || statusQuo.name,
        totals: statusQuoTotals,
      }),
      monthlyCostChartItem({
        id: "ny-bolig",
        name: nyBolig.adresse?.trim() || nyBolig.name,
        totals: {
          ...nyBoligTotals,
          monthlyTotal: nyBoligCostMonthly,
        },
      }),
    ],
    [statusQuo, statusQuoTotals, nyBolig, nyBoligTotals, nyBoligCostMonthly],
  );

  const nyBoligLiquidity = useMemo(() => {
    const operating = calculateOperatingCosts(nyBolig);
    const monthlyOperating =
      operating.monthlyTotal - (nyBolig.utleieAktivert ? nyBoligTotals.utleie.nettoInntektMnd : 0);

    return buildLiquidityCashFlow({
      years: nyBolig.likviditetAar ?? 10,
      monthlyOperatingCost: Math.max(0, monthlyOperating),
      monthlyLoanPayment: nyBoligTotals.monthlyLoanCost,
      maintenancePlan: nyBolig.maintenancePlan ?? [],
      inflasjonProsent: nyBolig.likviditetInflasjon ?? 2.5,
      rentefradragSats: (nyBolig.skattesatsProsent ?? 22) / 100,
      umiddelbarKapital: nyBolig.engangsTiltakTilstand ?? 0,
    });
  }, [nyBolig, nyBoligTotals]);

  return (
    <main className="page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Kalkulator for boligkostnader</h1>
          <p>
            Sammenlign nåværende bolig med en ny, eller flere boformer side om side.
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="button header-excel-btn"
            onClick={handleExportExcel}
            title="Last ned Excel-rapport med kostnadssammenligning"
          >
            Last ned Excel-rapport
          </button>
          <button
            type="button"
            className="button theme-toggle"
            onClick={toggleTheme}
            aria-pressed={theme === "dark"}
            aria-label={theme === "dark" ? "Bytt til lyst tema" : "Bytt til mørkt tema"}
          >
            {theme === "dark" ? "Lys modus" : "Mørk modus"}
          </button>
        </div>
      </header>

      <AuthPanel user={authUser} onAuthChange={setAuthUser} />

      <nav className="app-nav" aria-label="Hovedvisning">
        <button
          type="button"
          className={`tab ${pageView === "calculator" ? "tab-active" : ""}`}
          onClick={() => setPageView("calculator")}
        >
          Kalkulator
        </button>
        <button
          type="button"
          className={`tab ${pageView === "dashboard" ? "tab-active" : ""}`}
          onClick={() => setPageView("dashboard")}
        >
          Mine lagringer
        </button>
      </nav>

      {pageView === "dashboard" ? (
        <Dashboard
          user={authUser}
          onOpen={openSavedCalculation}
          onBack={() => setPageView("calculator")}
          refreshToken={simulationsVersion}
        />
      ) : (
        <>
      <SavedSimulationsPanel
        user={authUser}
        onOpen={openSavedCalculation}
        variant="top"
        refreshToken={simulationsVersion}
        onViewAll={() => setPageView("dashboard")}
      />

      <div className="app-shell">
        <SavedSimulationsPanel
          user={authUser}
          onOpen={openSavedCalculation}
          variant="sidebar"
          refreshToken={simulationsVersion}
          onViewAll={() => setPageView("dashboard")}
        />

        <div className="app-main">
      <div className="share-row">
        <button type="button" className="button button-primary" onClick={copyShareLink}>
          Kopier delbar lenke
        </button>
        <button type="button" className="button" onClick={saveNow}>
          Lagre nå
        </button>
        <button type="button" className="button" onClick={resetSaved}>
          Tøm lagring
        </button>
        {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
        {saveStatus ? <p className="share-status">{saveStatus}</p> : null}
        {lastSavedAt ? (
          <p className="share-status">
            Sist lagret{authUser ? " (sky + lokal)" : ""}: {formatSavedTime(lastSavedAt)}
          </p>
        ) : null}
      </div>

      <section className="saved-overview">
        <h2>Boliger og lagrede resultater</h2>
        <div className="saved-grid">
          <article className="saved-card">
            <h3>{statusQuo.adresse?.trim() || statusQuo.name}</h3>
            <p className="saved-label">Nåværende bolig</p>
            <p>
              Månedlig: <strong>{asCurrency(statusQuoTotals.monthlyTotal)}</strong>
            </p>
            <p>
              Årlig: <strong>{asCurrency(statusQuoTotals.yearlyTotal)}</strong>
            </p>
            <p>
              Netto fra salg: <strong>{asCurrency(statusQuoTotals.nettoFraSalg)}</strong>
            </p>
          </article>
          <article className="saved-card">
            <h3>{nyBolig.adresse?.trim() || nyBolig.name}</h3>
            <p className="saved-label">Ny bolig</p>
            <p>
              Månedlig: <strong>{asCurrency(nyBoligCostMonthly)}</strong>
              {nyBolig.utleieAktivert ? <span className="hint"> (etter utleie)</span> : null}
            </p>
            <p>
              Årlig: <strong>{asCurrency(nyBoligCostYearly)}</strong>
            </p>
            <p>
              Lånebehov: <strong>{asCurrency(nyBoligTotals.laan)}</strong>
            </p>
          </article>
          {results.map((result) => (
            <article key={result.id} className="saved-card">
              <h3>{result.adresse?.trim() || result.name}</h3>
              <p className="saved-label">{result.name}</p>
              <p>
                Månedlig: <strong>{asCurrency(result.totals.monthlyTotal)}</strong>
              </p>
              <p>
                Årlig: <strong>{asCurrency(result.totals.yearlyTotal)}</strong>
              </p>
            </article>
          ))}
        </div>
      </section>

      <nav className="tabs" aria-label="Visning">
        <button
          type="button"
          className={`tab ${activeTab === "flytt" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("flytt")}
        >
          Status quo vs ny bolig
        </button>
        <button
          type="button"
          className={`tab ${activeTab === "boformer" ? "tab-active" : ""}`}
          onClick={() => setActiveTab("boformer")}
        >
          Sammenlign flere boformer
        </button>
      </nav>

      <section className="importer">
        <h2>Importer fra FINN</h2>
        <p>
          {activeTab === "flytt"
            ? "Lim inn FINN-lenke for hver bolig – også utgåtte annonser. Vi henter fra lagret annonsedata, side og ev. arkivert kopi."
            : "Henter tall fra FINN, salgsoppgave og tilstandsrapport – også utgåtte annonser."}
        </p>

        {activeTab === "flytt" ? (
          <>
            <div className="importer-dual">
              <label className="field">
                <span>FINN-url – nåværende bolig</span>
                <input
                  type="url"
                  value={finnUrlNaa}
                  onChange={(event) => setFinnUrlNaa(event.target.value)}
                  placeholder="https://www.finn.no/realestate/homes/ad.html?finnkode=..."
                />
              </label>
              <label className="field">
                <span>FINN-url – ny bolig</span>
                <input
                  type="url"
                  value={finnUrlNy}
                  onChange={(event) => setFinnUrlNy(event.target.value)}
                  placeholder="https://www.finn.no/realestate/homes/ad.html?finnkode=..."
                />
              </label>
            </div>
            <div className="importer-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={importBothFlyttFromFinn}
                disabled={isImporting}
              >
                {isImporting ? "Henter..." : "Hent begge boliger"}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => importFlyttFromFinn("naa")}
                disabled={isImporting}
              >
                Hent nåværende
              </button>
              <button
                type="button"
                className="button"
                onClick={() => importFlyttFromFinn("ny")}
                disabled={isImporting}
              >
                Hent ny bolig
              </button>
            </div>
          </>
        ) : (
          <div className="importer-controls">
            <label className="field">
              <span>FINN-url</span>
              <input
                type="url"
                value={finnUrl}
                onChange={(event) => setFinnUrl(event.target.value)}
                placeholder="https://www.finn.no/realestate/homes/ad.html?finnkode=..."
              />
            </label>
            <label className="field">
              <span>Fyll inn i boform</span>
              <select
                value={effectiveTargetFormId}
                onChange={(event) => setTargetFormId(readNumber(event.target.value))}
              >
                {selectableForms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button"
              onClick={importFromFinn}
              disabled={isImporting}
            >
              {isImporting ? "Henter..." : "Hent data"}
            </button>
          </div>
        )}
        {importStatus ? <p className="import-status">{importStatus}</p> : null}
      </section>

      {activeTab === "flytt" ? (
        <>
          <section className="cards move-cards">
            <HousingCard
              title={statusQuo.name}
              item={statusQuo}
              fields={statusQuoFields}
              onFieldChange={(field, value) =>
                setStatusQuo((current) => ({ ...current, [field]: value }))
              }
              beforeGrid={
                <div className="verdi-panel verdi-panel-first">
                  <fieldset className="verdi-modus">
                    <legend>Verdi i dag – utgangspunkt for beregninger</legend>
                    <label className="radio-field">
                      <input
                        type="radio"
                        name="verdiModus"
                        checked={statusQuo.verdiModus !== "estimert"}
                        onChange={() => setVerdiModus("manuell")}
                      />
                      <span>Manuell verdi i dag</span>
                    </label>
                    <label className="radio-field">
                      <input
                        type="radio"
                        name="verdiModus"
                        checked={statusQuo.verdiModus === "estimert"}
                        onChange={() => setVerdiModus("estimert")}
                      />
                      <span>Estimert prisstigning (kommune + %/år)</span>
                    </label>
                  </fieldset>
                  {statusQuo.verdiModus === "estimert" ? (
                    <>
                      <label className="field">
                        <span>Kommune</span>
                        <select
                          value={statusQuo.kommune}
                          onChange={(event) => {
                            const kommune = event.target.value;
                            setStatusQuo((current) => ({
                              ...current,
                              kommune,
                              verdistigningAarlig: getKommuneRate(kommune),
                            }));
                          }}
                        >
                          {KOMMUNER.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label} (ca. {item.verdistigningAarlig} %/år)
                            </option>
                          ))}
                        </select>
                      </label>
                      <CostInput
                        label="Estimert verdistigning (%/år)"
                        value={statusQuo.verdistigningAarlig}
                        onChange={(value) =>
                          setStatusQuo((current) => ({
                            ...current,
                            verdistigningAarlig: value,
                          }))
                        }
                        step={0.1}
                      />
                      <p className="hint">
                        Egenkapital og netto fra salg beregnes fra estimatet (kjøpspris, tid,
                        prisstigning og kvm).
                      </p>
                    </>
                  ) : (
                    <>
                      <CostInput
                        label="Verdi i dag – manuell (kr)"
                        value={statusQuo.verdiIDag}
                        onChange={(value) =>
                          setStatusQuo((current) => ({
                            ...current,
                            verdiIDag: value,
                            verdiModus: "manuell",
                          }))
                        }
                      />
                      <p className="hint">
                        Trykk Enter eller Tab for å oppdatere. Estimert verdi vises under
                        resultatene.
                      </p>
                    </>
                  )}
                </div>
              }
              children={
                <>
                <div className="utleie-panel">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={statusQuo.dokumentavgiftAktivert}
                      onChange={(event) =>
                        setStatusQuo((current) => ({
                          ...current,
                          dokumentavgiftAktivert: event.target.checked,
                        }))
                      }
                    />
                    <span>Inkluder dokumentavgift ved kjøp (skjøte)</span>
                  </label>
                  {statusQuo.dokumentavgiftAktivert ? (
                    <div className="grid">
                      <CostInput
                        label="Dokumentavgift (%)"
                        value={statusQuo.dokumentavgiftProsent}
                        onChange={(value) =>
                          setStatusQuo((current) => ({
                            ...current,
                            dokumentavgiftProsent: value,
                          }))
                        }
                        step={0.1}
                      />
                    </div>
                  ) : null}
                  <p className="hint">
                    Beregnes av kjøpspris ({asCurrency(statusQuo.kjopspris)}). Gjelder
                    engangskostnad da du kjøpte nåværende bolig.
                  </p>
                </div>
                <TilstandsrapportPanel
                  title="Tilstandsrapport (nåværende bolig)"
                  home={statusQuo}
                  onUpdate={setStatusQuo}
                  onStatus={setImportStatus}
                  authUser={authUser}
                  homeContext="statusQuo"
                />
                </>
              }
              totals={
                <>
                  {statusQuo.engangsTiltakTilstand > 0 ? (
                    <p>
                      Nødvendige tiltak (tilstandsrapport):{" "}
                      <strong>{asCurrency(statusQuo.engangsTiltakTilstand)}</strong>
                    </p>
                  ) : null}
                  {statusQuo.dokumentavgiftAktivert ? (
                    <>
                      <p>
                        Dokumentavgift ved kjøp ({statusQuo.dokumentavgiftProsent} %):{" "}
                        <strong>{asCurrency(statusQuoTotals.dokumentavgift)}</strong>
                      </p>
                      <p>
                        Total kjøpskostnad (pris + dok.avg.):{" "}
                        <strong>{asCurrency(statusQuoTotals.totalKjopskostnad)}</strong>
                      </p>
                    </>
                  ) : null}
                  <p>
                    Tid i boligen:{" "}
                    <strong>{statusQuoTotals.aarBodd.toFixed(1)} år</strong>
                    <span className="hint">
                      {" "}
                      (siden {formatDateNb(statusQuoTotals.overtakelsesdato)})
                    </span>
                  </p>
                  <p>
                    {statusQuoTotals.verdiModus === "estimert"
                      ? "Verdi i dag (estimert prisstigning)"
                      : "Verdi i dag (manuell)"}
                    : <strong>{asCurrency(statusQuoTotals.effectiveVerdi)}</strong>
                    <span className="hint">
                      {" "}
                      ({statusQuoTotals.verdistigning.prosent >= 0 ? "+" : ""}
                      {statusQuoTotals.verdistigning.prosent.toFixed(1)} % siden kjøp)
                    </span>
                  </p>
                  {statusQuoTotals.verdiModus === "manuell" ? (
                    <p className="hint">
                      Estimert alternativ ({statusQuo.verdistigningAarlig} %/år):{" "}
                      <strong>{asCurrency(statusQuoTotals.estimertVerdi)}</strong>
                    </p>
                  ) : null}
                  <p>
                    Restgjeld: <strong>{asCurrency(statusQuoTotals.restgjeld)}</strong>
                    {statusQuo.restgjeld === 0 ? (
                      <span className="hint"> (beregnet)</span>
                    ) : null}
                  </p>
                  <p>
                    Egenkapital i dag: <strong>{asCurrency(statusQuoTotals.egenkapital)}</strong>
                  </p>
                  <p>
                    Netto fra salg: <strong>{asCurrency(statusQuoTotals.nettoFraSalg)}</strong>
                  </p>
                  <p>
                    Månedlig lånekostnad:{" "}
                    <strong>{asCurrency(statusQuoTotals.monthlyLoanCost)}</strong>
                  </p>
                  <p>
                    Total per måned: <strong>{asCurrency(statusQuoTotals.monthlyTotal)}</strong>
                  </p>
                  <p>
                    Total per år: <strong>{asCurrency(statusQuoTotals.yearlyTotal)}</strong>
                  </p>
                </>
              }
            />
            <HousingCard
              title={nyBolig.name}
              item={nyBolig}
              fields={nyBoligFields}
              onFieldChange={(field, value) =>
                setNyBolig((current) => ({ ...current, [field]: value }))
              }
              children={
                <>
                <div className="utleie-panel">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={nyBolig.dokumentavgiftAktivert}
                      onChange={(event) =>
                        setNyBolig((current) => ({
                          ...current,
                          dokumentavgiftAktivert: event.target.checked,
                        }))
                      }
                    />
                    <span>Inkluder dokumentavgift ved tinglysing (skjøte)</span>
                  </label>
                  <p className="hint">
                    Standard dokumentavgift er 2,5 % av kjøpesum. Betales som engangskostnad ved kjøp
                    (kommer i tillegg til lån, med mindre du dekker det med egne midler).
                  </p>
                </div>
                <div className="utleie-panel">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={nyBolig.utleieAktivert}
                      onChange={(event) =>
                        setNyBolig((current) => ({
                          ...current,
                          utleieAktivert: event.target.checked,
                        }))
                      }
                    />
                    <span>Planlegger skattefri utleie (f.eks. hybel/del av boligen)</span>
                  </label>
                  <p className="hint">
                    Typisk skattefri grense for utleie av egen bolig: ca. 20 000 kr/år
                    (justér etter egen situasjon). Overskudd over grensen beregnes med
                    skattesatsen du legger inn.
                  </p>
                  {nyBolig.utleieAktivert ? (
                    <div className="grid">
                      {utleieFields.map((field) => (
                        <CostInput
                          key={field.key}
                          label={field.label}
                          value={nyBolig[field.key]}
                          onChange={(value) =>
                            setNyBolig((current) => ({ ...current, [field.key]: value }))
                          }
                          step={field.step ?? 1000}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <TilstandsrapportPanel
                  title="Tilstandsrapport (ny bolig)"
                  home={nyBolig}
                  onUpdate={setNyBolig}
                  onStatus={setImportStatus}
                  authUser={authUser}
                  homeContext="nyBolig"
                />
                </>
              }
              totals={
                <>
                  <p className="result-heading">Finansiering av boligpris</p>
                  <p>
                    Egenkapital fra salg:{" "}
                    <strong>{asCurrency(nyBoligTotals.egenkapitalFraSalg)}</strong>
                  </p>
                  <p>
                    + Ekstra kontanter (egenkapital):{" "}
                    <strong>{asCurrency(nyBoligTotals.kontanterEgenkapital)}</strong>
                  </p>
                  <p>
                    = Total egenkapital (mot boligpris):{" "}
                    <strong>{asCurrency(nyBoligTotals.totalEgenkapital)}</strong>
                  </p>
                  <p className="hint">
                    Dokumentavgift er ikke inkludert i total egenkapital – den betales
                    kontant ved tinglysing.
                  </p>
                  <p>
                    Boligpris: <strong>{asCurrency(nyBoligTotals.boligpris)}</strong>
                  </p>
                  <p>
                    Nytt lånebehov: <strong>{asCurrency(nyBoligTotals.laan)}</strong>
                  </p>

                  <p className="result-heading">Kontantutgifter ved kjøp (i tillegg)</p>
                  {nyBolig.dokumentavgiftAktivert ? (
                    <p>
                      Dokumentavgift ({nyBolig.dokumentavgiftProsent} %):{" "}
                      <strong>{asCurrency(nyBoligTotals.dokumentavgift)}</strong>
                    </p>
                  ) : null}
                  <p>
                    Flyttekostnader:{" "}
                    <strong>{asCurrency(nyBoligTotals.flyttekostnader)}</strong>
                  </p>
                  {nyBoligTotals.engangsTiltakTilstand > 0 ? (
                    <p>
                      Tiltak etter tilstandsrapport:{" "}
                      <strong>{asCurrency(nyBoligTotals.engangsTiltakTilstand)}</strong>
                    </p>
                  ) : null}
                  <p>
                    Sum engangskostnader ved kjøp:{" "}
                    <strong>{asCurrency(nyBoligTotals.engangskostnader)}</strong>
                  </p>
                  <p className="hint">
                    Inkl. dokumentavgift, flytt og nødvendige tiltak fra tilstandsrapport.
                  </p>
                  <p>
                    Kontanter til dok. + flytt + tiltak:{" "}
                    <strong>{asCurrency(nyBoligTotals.kontanterTilDokOgFlytt)}</strong>
                  </p>
                  <p>
                    Kontanter fra egen lomme (ekstra egenkap. + engangskostnader):{" "}
                    <strong>{asCurrency(nyBoligTotals.kontanterFraLomme)}</strong>
                  </p>
                  <p>
                    Månedlig lånekostnad:{" "}
                    <strong>{asCurrency(nyBoligTotals.monthlyLoanCost)}</strong>
                  </p>
                  <p>
                    Total per måned (før utleie):{" "}
                    <strong>{asCurrency(nyBoligTotals.monthlyTotal)}</strong>
                  </p>
                  {nyBolig.utleieAktivert ? (
                    <>
                      <p>
                        Netto utleie per måned:{" "}
                        <strong className="difference difference-positive">
                          −{asCurrency(nyBoligTotals.utleie.nettoInntektMnd)}
                        </strong>
                      </p>
                      <p>
                        Ekstra utgifter ved utleie (år):{" "}
                        <strong>{asCurrency(nyBoligTotals.utleie.ekstraKostnaderAar)}</strong>
                      </p>
                      <p>
                        Estimert skatt av utleie (år):{" "}
                        <strong>{asCurrency(nyBoligTotals.utleie.skattAar)}</strong>
                      </p>
                      <p>
                        Din faktiske kostnad per måned:{" "}
                        <strong>{asCurrency(nyBoligTotals.monthlyNetCost)}</strong>
                      </p>
                    </>
                  ) : null}
                  <p>
                    Total per år:{" "}
                    <strong>
                      {asCurrency(
                        nyBolig.utleieAktivert
                          ? nyBoligTotals.yearlyNetCost
                          : nyBoligTotals.yearlyTotal,
                      )}
                    </strong>
                  </p>
                </>
              }
            />
          </section>

          <section className="comparison move-comparison">
            <h2>Flyttesammenligning</h2>
            <p className="comparison-intro">
              Sammenligner løpende kostnader og finansiering ved flytting fra nåværende til ny bolig.
            </p>
            <div className="comparison-grid">
              <article className="comparison-card">
                <h3>{statusQuo.name}</h3>
                <p>
                  Månedlig total: <strong>{asCurrency(statusQuoTotals.monthlyTotal)}</strong>
                </p>
                <p>
                  Årlig total: <strong>{asCurrency(statusQuoTotals.yearlyTotal)}</strong>
                </p>
              </article>
              <article className="comparison-card">
                <h3>{nyBolig.name}</h3>
                <p>
                  Månedlig total: <strong>{asCurrency(nyBoligCostMonthly)}</strong>
                  {nyBolig.utleieAktivert ? (
                    <span className="hint"> (etter utleie)</span>
                  ) : null}
                </p>
                <p>
                  Årlig total: <strong>{asCurrency(nyBoligCostYearly)}</strong>
                </p>
              </article>
              <article className="comparison-card comparison-card-delta">
                <h3>Differanse (ny − nå)</h3>
                <p>
                  Per måned:{" "}
                  <strong className={differenceClassName(moveDeltaMonthly)}>
                    {asCurrency(moveDeltaMonthly)}
                  </strong>
                </p>
                <p>
                  Per år:{" "}
                  <strong className={differenceClassName(moveDeltaYearly)}>
                    {asCurrency(moveDeltaYearly)}
                  </strong>
                </p>
                <p>
                  Dokumentavgift:{" "}
                  <strong>{asCurrency(nyBoligTotals.dokumentavgift)}</strong>
                </p>
                <p>
                  Flyttekostnad:{" "}
                  <strong>{asCurrency(nyBoligTotals.flyttekostnader)}</strong>
                </p>
                <p>
                  Sum engangskostnader ved kjøp:{" "}
                  <strong>{asCurrency(nyBoligTotals.engangskostnader)}</strong>
                </p>
                <p className="hint">
                  Positiv differanse = dyrere å bo i ny bolig per måned/år.
                </p>
              </article>
            </div>
            <BarChart
              title="Månedlig kostnad – søylediagram"
              subtitle="Blå = lån, grønn = drift og felleskostnader"
              items={flyttChartItems}
              formatValue={asCurrency}
            />
            {(nyBolig.maintenancePlan?.length ?? 0) > 0 ? (
              <CashFlowChart
                scenario={nyBoligLiquidity}
                title={`Likviditetsbudsjett – ${nyBolig.adresse?.trim() || nyBolig.name}`}
              />
            ) : null}
          </section>
        </>
      ) : (
        <>
          <section className="toolbar">
            <button type="button" className="button" onClick={addForm}>
              Legg til boform
            </button>
            <button type="button" className="button" onClick={() => exportCsv(forms, results)}>
              Eksport til CSV
            </button>
            <button type="button" className="button" onClick={() => exportPdf(results)}>
              Eksport til PDF
            </button>
          </section>

          <section className="cards">
            {forms.map((form) => {
              const summary = results.find((result) => result.id === form.id);
              return (
                <FormCard
                  key={form.id}
                  item={form}
                  totals={summary?.totals ?? calculateCosts(form)}
                  onUpdate={updateForm}
                  onRemove={removeForm}
                  canRemove={forms.length > 1}
                />
              );
            })}
          </section>

          <section className="comparison">
            <h2>Sammenligning</h2>
            {baseline ? (
              <p className="comparison-intro">
                Differanser vises mot <strong>{baseline.name}</strong>.
              </p>
            ) : null}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Boform</th>
                    <th scope="col" className="num">
                      Per måned
                    </th>
                    <th scope="col" className="num">
                      Per år
                    </th>
                    {baseline ? (
                      <>
                        <th scope="col" className="num">
                          Δ måned
                        </th>
                        <th scope="col" className="num">
                          Δ år
                        </th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {sortedResults.map((result) => {
                    const deltaMonthly = baseline
                      ? result.totals.monthlyTotal - baseline.totals.monthlyTotal
                      : 0;
                    const deltaYearly = baseline
                      ? result.totals.yearlyTotal - baseline.totals.yearlyTotal
                      : 0;
                    const isBaseline = baseline?.id === result.id;

                    return (
                      <tr
                        key={result.id}
                        className={isBaseline ? "row-baseline" : undefined}
                      >
                        <td>{result.adresse?.trim() || result.name}</td>
                        <td className="num">{asCurrency(result.totals.monthlyTotal)}</td>
                        <td className="num">{asCurrency(result.totals.yearlyTotal)}</td>
                        {baseline ? (
                          <>
                            <td className="num">
                              {isBaseline ? (
                                "—"
                              ) : (
                                <span className={differenceClassName(deltaMonthly)}>
                                  {asCurrency(deltaMonthly)}
                                </span>
                              )}
                            </td>
                            <td className="num">
                              {isBaseline ? (
                                "—"
                              ) : (
                                <span className={differenceClassName(deltaYearly)}>
                                  {asCurrency(deltaYearly)}
                                </span>
                              )}
                            </td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <BarChart
              title="Månedlig kostnad per boform"
              subtitle={
                baseline
                  ? `Markert søyle: ${baseline.adresse?.trim() || baseline.name} (referanse)`
                  : "Sammenlign totalkostnad per måned"
              }
              items={boformerChartItems}
              formatValue={asCurrency}
            />
          </section>
        </>
      )}
        </div>
      </div>
        </>
      )}
    </main>
  );
}
