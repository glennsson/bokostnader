import React, { useEffect, useRef, useState } from "react";
import {
  canUseAsyncTilstandsrapport,
  subscribeTilstandsrapportJob,
  uploadAndQueueTilstandsrapport,
} from "./tilstandsrapportCloud";

async function fetchTilstandsrapport(body) {
  let response;
  try {
    response = await fetch("/api/tilstandsrapport/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Kunne ikke nå API-serveren. Stopp andre «npm run dev»-vinduer og start på nytt.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      response.status === 404
        ? "API mangler tilstandsrapport-rute – start «npm run dev» på nytt."
        : `Serverfeil (HTTP ${response.status}).`,
    );
  }

  const data = await response.json();
  if (!response.ok) {
    const detail = data?.details ? ` (${data.details})` : "";
    throw new Error((data?.error ?? "Kunne ikke lese tilstandsrapport.") + detail);
  }
  return data;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Kunne ikke lese filen."));
        return;
      }
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Kunne ikke lese filen."));
    reader.readAsDataURL(file);
  });
}

export function applyTilstandsrapportToHome(home, parsed, { useNodvendigSum = true } = {}) {
  const maintenancePlan = parsed.maintenancePlan ?? [];
  const sumUmiddelbar =
    Number(parsed.sumUmiddelbar) ||
    maintenancePlan
      .filter((item) => item.planlagtAar === 0 && (item.tg >= 3 || item.nodvendig))
      .reduce((s, item) => s + (Number(item.belop) || 0), 0);

  const sumNodvendig = Number(parsed.sumNodvendig) || 0;
  const sumTotal = Number(parsed.sumTotal) || 0;

  const sum = useNodvendigSum
    ? sumUmiddelbar || sumNodvendig || sumTotal
    : sumTotal;

  return {
    ...home,
    tilstandsTiltak: parsed.tiltak ?? [],
    maintenancePlan,
    engangsTiltakTilstand: Number.isFinite(sum) ? Math.round(sum) : 0,
    tilstandsrapportUrl: parsed.dokumentUrl ?? home.tilstandsrapportUrl ?? "",
  };
}

export default function TilstandsrapportPanel({
  title,
  home,
  onUpdate,
  onStatus,
  authUser,
  homeContext = "nyBolig",
}) {
  const fileInputRef = useRef(null);
  const [url, setUrl] = useState(home.tilstandsrapportUrl ?? "");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [asyncStatus, setAsyncStatus] = useState(null);
  const [filter, setFilter] = useState("nodvendig");

  const useAsync = canUseAsyncTilstandsrapport() && Boolean(authUser);

  const tiltak = home.tilstandsTiltak ?? [];
  const maintenancePlan = home.maintenancePlan ?? [];
  const visibleTiltak =
    filter === "alle"
      ? tiltak
      : tiltak.filter((item) => item.nodvendig || item.tg === 3);

  const applyParsed = (parsed, message) => {
    onUpdate(applyTilstandsrapportToHome(home, parsed));
    onStatus?.(message);
    setAsyncStatus(null);
  };

  useEffect(() => {
    return () => setAsyncStatus(null);
  }, []);

  const handleAsyncJobUpdate = (row) => {
    if (row.status === "processing") {
      setAsyncStatus({ phase: "processing", message: "Parser rapport i skyen …" });
      return;
    }

    if (row.status === "failed") {
      setBusy(false);
      setAsyncStatus({
        phase: "failed",
        message: row.error_message ?? "Parsing feilet.",
      });
      onStatus?.(row.error_message ?? "Parsing feilet.");
      return;
    }

    if (row.status === "completed" && row.result) {
      setBusy(false);
      applyParsed(
        row.result,
        `Fant ${row.result.tiltak?.length ?? 0} tiltak – koblet til likviditetsbudsjett.`,
      );
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      onStatus?.("Velg en PDF-fil (.pdf).");
      return;
    }

    setBusy(true);
    onStatus?.("");

    if (useAsync) {
      setAsyncStatus({ phase: "upload", message: "Laster opp til skyen …" });
      try {
        const job = await uploadAndQueueTilstandsrapport(file, {
          homeContext,
          propertyId: home.propertyId ?? null,
        });
        setAsyncStatus({ phase: "processing", message: "Venter på parsing …" });

        const unsubscribe = subscribeTilstandsrapportJob(job.id, {
          onUpdate: (row) => {
            handleAsyncJobUpdate(row);
            if (row.status === "completed" || row.status === "failed") {
              unsubscribe();
            }
          },
          onError: () => {
            onStatus?.("Realtime utilgjengelig – sjekk at tabellen er aktivert for Replication.");
          },
        });
      } catch (error) {
        setBusy(false);
        setAsyncStatus({
          phase: "failed",
          message: error instanceof Error ? error.message : "Opplasting feilet.",
        });
        onStatus?.(error instanceof Error ? error.message : "Opplasting feilet.");
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
      return;
    }

    setAsyncStatus({ phase: "processing", message: "Leser PDF lokalt …" });
    try {
      const pdfBase64 = await readFileAsBase64(file);
      const parsed = await fetchTilstandsrapport({ pdfBase64 });
      applyParsed(
        parsed,
        `Fant ${parsed.tiltak.length} tiltak – sum ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
      );
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Kunne ikke lese PDF.");
      setAsyncStatus(null);
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFetchUrl = async () => {
    if (!url.trim()) {
      onStatus?.("Lim inn lenke til tilstandsrapport.");
      return;
    }

    setBusy(true);
    setAsyncStatus({ phase: "processing", message: "Henter rapport …" });
    try {
      const parsed = await fetchTilstandsrapport({ url: url.trim() });
      applyParsed(parsed, `Fant ${parsed.tiltak.length} tiltak.`);
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Parsing feilet.");
      setAsyncStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const handleParsePaste = async () => {
    if (!pasteText.trim()) {
      onStatus?.("Lim inn tekst fra tilstandsrapporten.");
      return;
    }

    setBusy(true);
    try {
      const parsed = await fetchTilstandsrapport({ text: pasteText });
      applyParsed(parsed, `Fant ${parsed.tiltak.length} tiltak i limt tekst.`);
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Parsing feilet.");
    } finally {
      setBusy(false);
    }
  };

  const clearTiltak = () => {
    onUpdate({
      ...home,
      tilstandsTiltak: [],
      maintenancePlan: [],
      engangsTiltakTilstand: 0,
    });
    onStatus?.("Tiltak fra tilstandsrapport er fjernet.");
    setAsyncStatus(null);
  };

  return (
    <section className="tilstand-panel">
      <h3>{title}</h3>
      <p className="hint">
        TG2/TG3 kobles til kostnadsdatabase og rulles inn i likviditetsbudsjettet.
        {useAsync ? " PDF lastes opp asynkront med status i sanntid." : " Logg inn for asynk opplasting."}
      </p>

      {asyncStatus ? (
        <div
          className={`tilstand-async-status tilstand-async-status--${asyncStatus.phase}`}
          role="status"
          aria-live="polite"
        >
          {asyncStatus.phase === "processing" || asyncStatus.phase === "upload" ? (
            <span className="tilstand-spinner" aria-hidden="true" />
          ) : null}
          <span>{asyncStatus.message}</span>
        </div>
      ) : null}

      <div className="tilstand-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileUpload}
          disabled={busy}
          className="tilstand-file-input"
          id={`tilstand-file-${title.replace(/\s/g, "-")}`}
        />
        <label
          htmlFor={`tilstand-file-${title.replace(/\s/g, "-")}`}
          className="button button-primary tilstand-file-label"
        >
          {busy ? "Jobber …" : "Last opp PDF"}
        </label>
      </div>

      <div className="tilstand-controls">
        <label className="field">
          <span>Eller lenke til rapport</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…/tilstandsrapport.pdf"
            disabled={busy}
          />
        </label>
        <button type="button" className="button" onClick={handleFetchUrl} disabled={busy}>
          Hent fra lenke
        </button>
      </div>

      <label className="field">
        <span>Eller lim inn tekst</span>
        <textarea
          className="tilstand-textarea"
          rows={4}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder="TG2/TG3 og kostnadsestimat …"
          disabled={busy}
        />
      </label>
      <button type="button" className="button" onClick={handleParsePaste} disabled={busy}>
        Les av limt tekst
      </button>

      {tiltak.length > 0 ? (
        <>
          <div className="tilstand-summary">
            <p>
              <strong>Umiddelbart kapitalbehov (år 0):</strong>{" "}
              {formatKr(home.engangsTiltakTilstand)}
            </p>
            {maintenancePlan.length > 0 ? (
              <p className="hint">
                Planlagte tiltak:{" "}
                {maintenancePlan
                  .filter((m) => m.planlagtAar > 0)
                  .map((m) => `${m.omrade} om ${m.planlagtAar} år`)
                  .join(" · ") || "ingen senere"}
              </p>
            ) : null}
          </div>

          <div className="tilstand-filter">
            <label className="radio-field">
              <input
                type="radio"
                name={`tilstand-filter-${title}`}
                checked={filter === "nodvendig"}
                onChange={() => setFilter("nodvendig")}
              />
              <span>Kun nødvendige / TG3</span>
            </label>
            <label className="radio-field">
              <input
                type="radio"
                name={`tilstand-filter-${title}`}
                checked={filter === "alle"}
                onChange={() => setFilter("alle")}
              />
              <span>Alle funn</span>
            </label>
            <button type="button" className="button button-danger" onClick={clearTiltak}>
              Fjern tiltak
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table tilstand-table">
              <thead>
                <tr>
                  <th scope="col">Område</th>
                  <th scope="col">TG</th>
                  <th scope="col">Planlagt</th>
                  <th scope="col">Kilde</th>
                  <th scope="col" className="num">
                    Beløp
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTiltak.map((item, index) => (
                  <tr key={`${item.omrade}-${index}`}>
                    <td>{item.kategori ?? item.omrade}</td>
                    <td>{item.tg != null ? `TG${item.tg}` : "—"}</td>
                    <td>
                      {item.planlagtAar === 0 ? "Nå" : `Om ${item.planlagtAar} år`}
                    </td>
                    <td>{item.kildeBelop === "rapport" ? "Rapport" : "Database"}</td>
                    <td className="num">{formatKr(item.belop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function formatKr(value) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}
