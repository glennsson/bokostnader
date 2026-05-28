import React, { useState } from "react";

async function fetchTilstandsrapport({ url, text }) {
  const response = await fetch("/api/tilstandsrapport/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url?.trim() || undefined, text: text?.trim() || undefined }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? "Kunne ikke lese tilstandsrapport.");
  }
  return data;
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
    onStatus?.("");
    try {
      const parsed = await fetchTilstandsrapport({ url });
      applyParsed(
        parsed,
        `Fant ${parsed.tiltak.length} tiltak – sum nødvendig ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
      );
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : "Parsing feilet.");
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
    onStatus?.("");
    try {
      const parsed = await fetchTilstandsrapport({ text: pasteText });
      applyParsed(
        parsed,
        `Fant ${parsed.tiltak.length} tiltak i limt tekst – sum nødvendig ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
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
        Henter kostnadsestimat for tiltak som bør eller må gjennomføres (TG2/TG3) per område i
        boligen, fra tilstandsrapport eller boligsalgsrapport.
      </p>

      <div className="tilstand-controls">
        <label className="field">
          <span>Lenke til tilstandsrapport (PDF/HTML)</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…/tilstandsrapport.pdf"
          />
        </label>
        <button type="button" className="button button-primary" onClick={handleFetchUrl} disabled={busy}>
          {busy ? "Henter …" : "Hent tiltak"}
        </button>
      </div>

      <label className="field">
        <span>Eller lim inn tekst fra rapporten</span>
        <textarea
          className="tilstand-textarea"
          rows={4}
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder="Lim inn avsnitt med TG-grader og kostnadsestimat …"
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
              Summen er lagt inn som engangskostnad (tiltak etter teknisk tilstand). Juster
              under flyttekostnader / vedlikehold om du vil fordele annerledes.
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
