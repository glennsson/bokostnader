import React, { useEffect, useMemo, useState } from "react";
import { buildShareUrl, readShareFromUrl } from "./share";

const MONTHS_PER_YEAR = 12;

const defaultForms = [
  {
    id: 1,
    name: "Enebolig",
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
  aarBodd: 5,
  kjopspris: 4200000,
  egenkapitalVedKjop: 840000,
  verdiIDag: 5200000,
  restgjeld: 0,
  rente: 4.8,
  nedbetalingstid: 25,
  driftAarlig: 32000,
  kommunaleAarlig: 20000,
  vedlikeholdAarlig: 22000,
  felleskostnaderMnd: 0,
  salgskostnader: 150000,
};

const defaultNyBolig = {
  name: "Ny bolig",
  boligpris: 5800000,
  kontanterEgenkapital: 200000,
  rente: 5.2,
  nedbetalingstid: 25,
  driftAarlig: 36000,
  kommunaleAarlig: 24000,
  vedlikeholdAarlig: 30000,
  felleskostnaderMnd: 0,
  flyttekostnader: 80000,
};

function calculateStatusQuo(statusQuo) {
  const laanVedKjop = Math.max(0, statusQuo.kjopspris - statusQuo.egenkapitalVedKjop);
  const beregnetRestgjeld = remainingLoanBalance(
    laanVedKjop,
    statusQuo.rente,
    statusQuo.nedbetalingstid,
    statusQuo.aarBodd,
  );
  const restgjeld =
    statusQuo.restgjeld > 0 ? statusQuo.restgjeld : beregnetRestgjeld;
  const gjenstaendeAar = Math.max(0, statusQuo.nedbetalingstid - statusQuo.aarBodd);
  const monthlyLoanCost = calculateMonthlyPayment(
    restgjeld,
    statusQuo.rente,
    Math.max(gjenstaendeAar, 1),
  );
  const operating = calculateOperatingCosts(statusQuo);
  const monthlyTotal = monthlyLoanCost + operating.monthlyTotal;
  const egenkapital = statusQuo.verdiIDag - restgjeld;
  const nettoFraSalg = statusQuo.verdiIDag - restgjeld - statusQuo.salgskostnader;

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

  return {
    egenkapitalFraSalg,
    kontanterEgenkapital: nyBolig.kontanterEgenkapital,
    totalEgenkapital,
    laan,
    monthlyLoanCost,
    yearlyRunningCosts: operating.yearlyRunningCosts,
    monthlyTotal,
    yearlyTotal: monthlyTotal * MONTHS_PER_YEAR,
    flyttekostnader: nyBolig.flyttekostnader,
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
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(readNumber(event.target.value))}
      />
    </label>
  );
}

function HousingCard({ title, item, fields, totals, onFieldChange }) {
  return (
    <article className="card card-highlight">
      <h2>{title}</h2>
      <div className="grid">
        {fields.map((field) => (
          <CostInput
            key={field.key}
            label={field.label}
            value={item[field.key]}
            onChange={(value) => onFieldChange(field.key, value)}
            step={field.step ?? 1000}
          />
        ))}
      </div>
      <div className="result">{totals}</div>
    </article>
  );
}

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
  { key: "aarBodd", label: "År bodd i boligen", step: 1 },
  { key: "kjopspris", label: "Kjøpspris (kr)" },
  { key: "egenkapitalVedKjop", label: "Egenkapital ved kjøp (kr)" },
  { key: "verdiIDag", label: "Estimert verdi i dag (kr)" },
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
  const [targetFormId, setTargetFormId] = useState(defaultForms[0].id);
  const [importStatus, setImportStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    const shared = readShareFromUrl();
    if (!shared) {
      return;
    }

    if (shared.activeTab === "flytt" || shared.activeTab === "boformer") {
      setActiveTab(shared.activeTab);
    }
    if (shared.statusQuo) {
      setStatusQuo(shared.statusQuo);
    }
    if (shared.nyBolig) {
      setNyBolig(shared.nyBolig);
    }
    if (Array.isArray(shared.forms) && shared.forms.length > 0) {
      setForms(shared.forms);
    }
    if (shared.nextId) {
      setNextId(shared.nextId);
    }
    setShareStatus("Data lastet fra delt lenke.");
  }, []);

  const statusQuoTotals = useMemo(() => calculateStatusQuo(statusQuo), [statusQuo]);
  const nyBoligTotals = useMemo(
    () => calculateNyBolig(nyBolig, statusQuoTotals.nettoFraSalg),
    [nyBolig, statusQuoTotals.nettoFraSalg],
  );

  const moveDeltaMonthly = nyBoligTotals.monthlyTotal - statusQuoTotals.monthlyTotal;
  const moveDeltaYearly = nyBoligTotals.yearlyTotal - statusQuoTotals.yearlyTotal;

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
        totals: calculateCosts(form),
      })),
    [forms],
  );

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
      const response = await fetch("/api/finn/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: finnUrl.trim() }),
      });

      const data = await response.json();
      if (!response.ok) {
        setImportStatus(data?.error ?? "Kunne ikke hente data fra FINN.");
        return;
      }

      if (activeTab === "flytt") {
        setNyBolig((current) => ({
          ...current,
          boligpris: data.boligpris ?? current.boligpris,
          felleskostnaderMnd: data.felleskostnaderMnd ?? current.felleskostnaderMnd,
          kommunaleAarlig: data.kommunaleAarlig ?? current.kommunaleAarlig,
        }));
        setImportStatus("Data hentet og fylt inn i ny bolig.");
      } else {
        setForms((current) =>
          current.map((form) => {
            if (form.id !== effectiveTargetFormId) {
              return form;
            }
            return {
              ...form,
              boligpris: data.boligpris ?? form.boligpris,
              felleskostnaderMnd: data.felleskostnaderMnd ?? form.felleskostnaderMnd,
              kommunaleAarlig: data.kommunaleAarlig ?? form.kommunaleAarlig,
            };
          }),
        );
        setImportStatus("Data hentet og fylt inn i valgt boform.");
      }
    } catch {
      setImportStatus("Noe gikk galt ved import.");
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

  return (
    <main className="page">
      <header>
        <h1>Kalkulator for boligkostnader</h1>
        <p>
          Sammenlign nåværende bolig med en ny, eller flere boformer side om side.
        </p>
      </header>

      <div className="share-row">
        <button type="button" className="button button-primary" onClick={copyShareLink}>
          Kopier delbar lenke
        </button>
        {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
      </div>

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
            ? "Lim inn annonse-lenke og fyll inn data i ny bolig."
            : "Lim inn annonse-lenke og fyll inn pris/avgifter i valgt boform."}
        </p>
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

          {activeTab === "boformer" ? (
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
          ) : null}

          <button
            type="button"
            className="button"
            onClick={importFromFinn}
            disabled={isImporting}
          >
            {isImporting ? "Henter..." : "Hent data"}
          </button>
        </div>
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
              totals={
                <>
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
              totals={
                <>
                  <p>
                    Egenkapital fra salg:{" "}
                    <strong>{asCurrency(nyBoligTotals.egenkapitalFraSalg)}</strong>
                  </p>
                  <p>
                    Nytt lånebehov: <strong>{asCurrency(nyBoligTotals.laan)}</strong>
                  </p>
                  <p>
                    Månedlig lånekostnad:{" "}
                    <strong>{asCurrency(nyBoligTotals.monthlyLoanCost)}</strong>
                  </p>
                  <p>
                    Total per måned: <strong>{asCurrency(nyBoligTotals.monthlyTotal)}</strong>
                  </p>
                  <p>
                    Total per år: <strong>{asCurrency(nyBoligTotals.yearlyTotal)}</strong>
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
                  Månedlig total: <strong>{asCurrency(nyBoligTotals.monthlyTotal)}</strong>
                </p>
                <p>
                  Årlig total: <strong>{asCurrency(nyBoligTotals.yearlyTotal)}</strong>
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
                  Engangs flyttekostnad:{" "}
                  <strong>{asCurrency(nyBoligTotals.flyttekostnader)}</strong>
                </p>
                <p className="hint">
                  Positiv differanse = dyrere å bo i ny bolig per måned/år.
                </p>
              </article>
            </div>
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
            <div className="comparison-grid">
              {sortedResults.map((result) => (
                <article key={result.id} className="comparison-card">
                  <h3>{result.name}</h3>
                  <p>
                    Månedlig total: <strong>{asCurrency(result.totals.monthlyTotal)}</strong>
                  </p>
                  <p>
                    Årlig total: <strong>{asCurrency(result.totals.yearlyTotal)}</strong>
                  </p>
                  {baseline && baseline.id !== result.id ? (
                    <>
                      <p>
                        Differanse per måned:{" "}
                        <strong
                          className={differenceClassName(
                            result.totals.monthlyTotal - baseline.totals.monthlyTotal,
                          )}
                        >
                          {asCurrency(
                            result.totals.monthlyTotal - baseline.totals.monthlyTotal,
                          )}
                        </strong>
                      </p>
                      <p>
                        Differanse per år:{" "}
                        <strong
                          className={differenceClassName(
                            result.totals.yearlyTotal - baseline.totals.yearlyTotal,
                          )}
                        >
                          {asCurrency(result.totals.yearlyTotal - baseline.totals.yearlyTotal)}
                        </strong>
                      </p>
                    </>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
