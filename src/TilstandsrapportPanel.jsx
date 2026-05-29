import React, { useRef, useState } from "react";

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
        ? "API mangler tilstandsrapport-rute – start «npm run dev» på nytt (port 8787 var sannsynligvis gammel)."
        : `Serverfeil (HTTP ${response.status}). Start «npm run dev» på nytt.`,
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
  const sum = useNodvendigSum
    ? parsed.sumNodvendig || parsed.sumTotal
    : parsed.sumTotal;

  return {
    ...home,
    tilstandsTiltak: parsed.tiltak ?? [],
    engangsTiltakTilstand: sum,
    tilstandsrapportUrl: parsed.dokumentUrl ?? home.tilstandsrapportUrl ?? "",
  };
}

export default function TilstandsrapportPanel({
  title,
  home,
  onUpdate,
  onStatus,
}) {
  const fileInputRef = useRef(null);
  const [url, setUrl] = useState(home.tilstandsrapportUrl ?? "");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("nodvendig");

  const tiltak = home.tilstandsTiltak ?? [];
  const visibleTiltak =
    filter === "alle"
      ? tiltak
      : tiltak.filter((item) => item.nodvendig || item.tg === 3);

  const applyParsed = (parsed, message) => {
    onUpdate(applyTilstandsrapportToHome(home, parsed));
    onStatus?.(message);
  };

  const handleFetchUrl = async () => {
    if (!url.trim()) {
      onStatus?.("Lim inn lenke til tilstandsrapport (PDF eller nettside).");
      return;
    }

    setBusy(true);
    onStatus?.("Henter rapport …");
    try {
      const parsed = await fetchTilstandsrapport({ url: url.trim() });
      applyParsed(
        parsed,
        `Fant ${parsed.tiltak.length} tiltak – sum ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
      );
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Parsing feilet.");
    } finally {
      setBusy(false);
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
    onStatus?.("Leser PDF …");
    try {
      const pdfBase64 = await readFileAsBase64(file);
      const parsed = await fetchTilstandsrapport({ pdfBase64 });
      applyParsed(
        parsed,
        `Fant ${parsed.tiltak.length} tiltak fra ${file.name} – sum ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
      );
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Kunne ikke lese PDF.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleParsePaste = async () => {
    if (!pasteText.trim()) {
      onStatus?.("Lim inn tekst fra tilstandsrapporten.");
      return;
    }

    setBusy(true);
    onStatus?.("");
    try {
      const parsed = await fetchTilstandsrapport({ text: pasteText });
      applyParsed(
        parsed,
        `Fant ${parsed.tiltak.length} tiltak i limt tekst – sum ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
      );
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
      engangsTiltakTilstand: 0,
    });
    onStatus?.("Tiltak fra tilstandsrapport er fjernet.");
  };

  return (
    <section className="tilstand-panel">
      <h3>{title}</h3>
      <p className="hint">
        Henter TG-tiltak og kostnadsestimat fra tilstandsrapport. Mange lenker krever innlogging –
        da er det enklest å <strong>laste opp PDF</strong> direkte.
      </p>

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
          {busy ? "Leser …" : "Last opp PDF"}
        </label>
      </div>

      <div className="tilstand-controls">
        <label className="field">
          <span>Eller lenke til rapport (PDF/HTML)</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…/tilstandsrapport.pdf"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className="button"
          onClick={handleFetchUrl}
          disabled={busy}
        >
          Hent fra lenke
        </button>
      </div>

      <label className="field">
        <span>Eller lim inn tekst (f.eks. kostnadstabell)</span>
        <textarea
          className="tilstand-textarea"
          rows={4}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder="Kopier avsnitt med TG2/TG3 og kostnadsestimat …"
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
              <strong>Sum nødvendig / TG3:</strong> {formatKr(home.engangsTiltakTilstand)}
            </p>
            <p className="hint">
              Summen er lagt inn som engangskostnad ved kjøp. Juster under flyttekostnader om
              nødvendig.
            </p>
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
                  <th scope="col">Beskrivelse</th>
                  <th scope="col" className="num">
                    Beløp
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTiltak.map((item, index) => (
                  <tr key={`${item.omrade}-${index}`}>
                    <td>{item.omrade}</td>
                    <td>{item.tg != null ? `TG${item.tg}` : "—"}</td>
                    <td>{item.beskrivelse || "—"}</td>
                    <td className="num">{formatKr(item.belop)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    <strong>Sum vist</strong>
                  </td>
                  <td className="num">
                    <strong>
                      {formatKr(visibleTiltak.reduce((s, i) => s + i.belop, 0))}
                    </strong>
                  </td>
                </tr>
              </tfoot>
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
