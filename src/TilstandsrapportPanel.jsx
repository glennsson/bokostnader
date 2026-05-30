import React, { useEffect, useMemo, useRef, useState } from "react";
import { computeTiltakTag, dedupeTiltakList, syncHomeFromTiltak } from "../lib/maintenance-cost-map.js";
import {
  canUseAsyncTilstandsrapport,
  uploadAndQueueTilstandsrapport,
  watchTilstandsrapportJob,
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

function isStorageSetupError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /bucket not found|02-tilstandsrapport-pdf-bucket/i.test(message);
}

async function parsePdfLocally(file, { onStatus, applyParsed }) {
  onStatus?.("");
  const pdfBase64 = await readFileAsBase64(file);
  const parsed = await fetchTilstandsrapport({ pdfBase64 });
  applyParsed(
    parsed,
    `Fant ${parsed.tiltak.length} tiltak – sum ${formatKr(parsed.sumNodvendig || parsed.sumTotal)}.`,
  );
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

export function calculateTiltakTotals(tiltakList) {
  return (tiltakList ?? []).reduce(
    (totals, item) => {
      const belop = Number(item.belop) || 0;
      totals.alle += belop;
      if (item.tg === 3) {
        totals.tg3 += belop;
      }
      if (item.tg === 2) {
        totals.tg2 += belop;
      }
      return totals;
    },
    { alle: 0, tg3: 0, tg2: 0 },
  );
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
  const jobWatchStopRef = useRef(null);
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

  const tiltakTotals = useMemo(() => calculateTiltakTotals(tiltak), [tiltak]);
  const tg3Count = useMemo(() => tiltak.filter((item) => item.tg === 3).length, [tiltak]);
  const tg2Count = useMemo(() => tiltak.filter((item) => item.tg === 2).length, [tiltak]);

  const tagCounts = useMemo(() => {
    const counts = new Map();
    for (const item of tiltak) {
      const tag = item.tag ?? computeTiltakTag(item);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return counts;
  }, [tiltak]);

  const duplicateTagCount = useMemo(
    () => [...tagCounts.values()].filter((count) => count > 1).length,
    [tagCounts],
  );

  const applyParsed = (parsed, message) => {
    onUpdate(applyTilstandsrapportToHome(home, parsed));
    onStatus?.(message);
    setAsyncStatus(null);
  };

  useEffect(() => {
    return () => {
      setAsyncStatus(null);
      jobWatchStopRef.current?.();
    };
  }, []);

  const updateTiltakItem = (sourceItem, updates) => {
    const nextTiltak = tiltak.map((row) =>
      row === sourceItem
        ? {
            ...row,
            ...updates,
            manueltRedigert: true,
            kildeBelop: "manuell",
          }
        : row,
    );
    onUpdate(syncHomeFromTiltak(home, nextTiltak));
    onStatus?.("Tiltak oppdatert – likviditetsbudsjett er justert.");
  };

  const handleBelopChange = (item, rawValue) => {
    updateTiltakItem(item, { belop: Math.max(0, Math.round(Number(rawValue) || 0)) });
  };

  const handleTgChange = (item, rawValue) => {
    const tg = Math.min(3, Math.max(0, Number(rawValue) || 0));
    updateTiltakItem(item, { tg, nodvendig: tg >= 3 || item.nodvendig });
  };

  const splitTiltakRow = (sourceItem) => {
    const index = tiltak.findIndex((row) => row === sourceItem || row.id === sourceItem.id);
    if (index < 0) {
      return;
    }

    const partCount = Math.max(2, sourceItem.slaattSammen ?? 1);
    const totalBelop = Math.max(0, Math.round(Number(sourceItem.belop) || 0));
    const baseShare = Math.floor(totalBelop / partCount);
    const remainder = totalBelop - baseShare * partCount;

    const parts = Array.from({ length: partCount }, (_, partIndex) => ({
      ...sourceItem,
      id: crypto.randomUUID(),
      kode: undefined,
      belop: baseShare + (partIndex === 0 ? remainder : 0),
      slaattSammen: 1,
      manueltRedigert: true,
      kildeBelop: "manuell",
    }));

    const nextTiltak = [...tiltak.slice(0, index), ...parts, ...tiltak.slice(index + 1)];
    onUpdate(syncHomeFromTiltak(home, nextTiltak));
    onStatus?.(
      `Rad delt i ${partCount} – beløpet (${formatKr(totalBelop)}) er fordelt. Juster hver rad etter behov.`,
    );
  };

  const deleteTiltakRow = (sourceItem) => {
    const nextTiltak = tiltak.filter((row) => row !== sourceItem && row.id !== sourceItem.id);
    if (nextTiltak.length === tiltak.length) {
      return;
    }
    if (nextTiltak.length === 0) {
      clearTiltak();
      return;
    }
    onUpdate(syncHomeFromTiltak(home, nextTiltak));
    onStatus?.("Tiltak fjernet – likviditetsbudsjett er oppdatert.");
  };

  const handleAsyncJobUpdate = (row) => {
    if (row.status === "processing") {
      setAsyncStatus({ phase: "processing", message: "Parser rapport i skyen …" });
      return;
    }

    if (row.status === "failed") {
      setBusy(false);
      jobWatchStopRef.current?.();
      setAsyncStatus({
        phase: "failed",
        message: row.error_message ?? "Parsing feilet.",
      });
      onStatus?.(row.error_message ?? "Parsing feilet.");
      return;
    }

    if (row.status === "completed" && row.result) {
      setBusy(false);
      jobWatchStopRef.current?.();
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

        jobWatchStopRef.current?.();
        jobWatchStopRef.current = watchTilstandsrapportJob(job.id, {
          onUpdate: (row) => {
            handleAsyncJobUpdate(row);
          },
          onError: (error) => {
            if (error?.message?.includes("2 minutter")) {
              setBusy(false);
              setAsyncStatus({ phase: "failed", message: error.message });
              onStatus?.(error.message);
              return;
            }
            onStatus?.(
              error instanceof Error
                ? error.message
                : "Realtime utilgjengelig – henter status via polling.",
            );
          },
        });
      } catch (error) {
        if (isStorageSetupError(error)) {
          setAsyncStatus({ phase: "processing", message: "Sky-lagring mangler – leser PDF lokalt …" });
          onStatus?.("Storage-bucket ikke satt opp – parser PDF lokalt i stedet.");
          try {
            await parsePdfLocally(file, { onStatus, applyParsed });
          } catch (localError) {
            setAsyncStatus({
              phase: "failed",
              message: localError instanceof Error ? localError.message : "Kunne ikke lese PDF.",
            });
            onStatus?.(localError instanceof Error ? localError.message : "Kunne ikke lese PDF.");
          } finally {
            setBusy(false);
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
          }
          return;
        }

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
      await parsePdfLocally(file, { onStatus, applyParsed });
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

  const mergeDuplicates = () => {
    const merged = dedupeTiltakList(tiltak);
    if (merged.length >= tiltak.length) {
      onStatus?.("Ingen duplikater å slå sammen.");
      return;
    }
    onUpdate(syncHomeFromTiltak(home, merged));
    onStatus?.(
      `Slått sammen ${tiltak.length - merged.length} duplikat(er) – totalen er oppdatert.`,
    );
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
            <button type="button" className="button" onClick={mergeDuplicates}>
              Slå sammen duplikater
            </button>
            <button type="button" className="button button-danger" onClick={clearTiltak}>
              Fjern tiltak
            </button>
          </div>

          <div className="tilstand-stat-cards" aria-label="Oppsummering av tiltakskostnader">
            <div className="tilstand-stat-card tilstand-stat-card--alle">
              <span className="tilstand-stat-card__label">Alle tiltak</span>
              <span className="tilstand-stat-card__value">{formatKr(tiltakTotals.alle)}</span>
              <span className="tilstand-stat-card__meta">
                {tiltak.length} {tiltak.length === 1 ? "post" : "poster"}
              </span>
            </div>
            <div className="tilstand-stat-card tilstand-stat-card--tg3">
              <span className="tilstand-stat-card__label">Kun TG3</span>
              <span className="tilstand-stat-card__value">{formatKr(tiltakTotals.tg3)}</span>
              <span className="tilstand-stat-card__meta">
                {tg3Count} {tg3Count === 1 ? "tiltak" : "tiltak"}
              </span>
            </div>
            <div className="tilstand-stat-card tilstand-stat-card--tg2">
              <span className="tilstand-stat-card__label">Kun TG2</span>
              <span className="tilstand-stat-card__value">{formatKr(tiltakTotals.tg2)}</span>
              <span className="tilstand-stat-card__meta">
                {tg2Count} {tg2Count === 1 ? "tiltak" : "tiltak"}
              </span>
            </div>
          </div>

          {tiltak.some((item) => (item.slaattSammen ?? 0) > 1) ? (
            <p className="hint tilstand-dedupe-hint">
              Like bygningsdeler fra flere steder i rapporten er slått sammen – totalen er
              ikke summert dobbelt.
            </p>
          ) : null}

          {duplicateTagCount > 0 ? (
            <p className="hint tilstand-tag-hint">
              Rader med <strong>samme #tag</strong> (TG + beløp) er sannsynlige duplikater – bruk
              «Slå sammen duplikater» eller «Slett».
            </p>
          ) : null}

          <p className="hint tilstand-edit-hint">
            Juster TG/beløp direkte. «Splitt rad» fordeler beløpet – totalen endres ikke.
            «Slett rad» fjerner feilaktige funn.
          </p>

          <div className="table-wrap">
            <table className="data-table tilstand-table">
              <thead>
                <tr>
                  <th scope="col">Kode</th>
                  <th scope="col">#tag</th>
                  <th scope="col">Område</th>
                  <th scope="col">TG</th>
                  <th scope="col">Planlagt</th>
                  <th scope="col">Kilde</th>
                  <th scope="col" className="num">
                    Beløp
                  </th>
                  <th scope="col" className="tilstand-actions-col">
                    <span className="visually-hidden">Handlinger</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTiltak.map((item) => {
                  const tag = item.tag ?? computeTiltakTag(item);
                  const isDuplicateTag = (tagCounts.get(tag) ?? 0) > 1;

                  return (
                  <tr
                    key={item.id ?? `${item.kategori ?? item.omrade}-${item.kode}`}
                    className={isDuplicateTag ? "tilstand-row--duplicate-tag" : undefined}
                  >
                    <td className="tilstand-kode">{item.kode ?? "—"}</td>
                    <td>
                      <code
                        className={`tilstand-tag${isDuplicateTag ? " tilstand-tag--duplicate" : ""}`}
                        title="TG + beløp + bygningsdel – lik tag = sannsynlig duplikat"
                      >
                        {tag}
                      </code>
                    </td>
                    <td>
                      {item.kategori ?? item.omrade}
                      {(item.slaattSammen ?? 0) > 1 ? (
                        <span className="tilstand-merged-badge" title="Flere funn slått sammen">
                          ×{item.slaattSammen}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <select
                        className="tilstand-inline-input tilstand-inline-input--tg"
                        value={item.tg ?? 0}
                        onChange={(event) => handleTgChange(item, event.target.value)}
                        aria-label={`TG for ${item.kategori ?? item.omrade}`}
                      >
                        {[0, 1, 2, 3].map((tg) => (
                          <option key={tg} value={tg}>
                            TG{tg}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {item.planlagtAar === 0 ? "Nå" : `Om ${item.planlagtAar} år`}
                    </td>
                    <td>{formatKilde(item.kildeBelop)}</td>
                    <td className="num">
                      <input
                        type="number"
                        className="tilstand-inline-input tilstand-inline-input--belop"
                        value={item.belop ?? 0}
                        min={0}
                        step={1000}
                        onChange={(event) => handleBelopChange(item, event.target.value)}
                        aria-label={`Beløp for ${item.kategori ?? item.omrade}`}
                      />
                    </td>
                    <td className="tilstand-actions-col">
                      <div className="tilstand-row-actions">
                        <button
                          type="button"
                          className="button tilstand-split-btn"
                          onClick={() => splitTiltakRow(item)}
                          title="Del beløpet på flere rader uten å øke totalen"
                        >
                          Splitt
                        </button>
                        <button
                          type="button"
                          className="button tilstand-delete-btn"
                          onClick={() => deleteTiltakRow(item)}
                          title="Fjern tiltak fra budsjettet"
                        >
                          Slett
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
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

function formatKilde(kilde) {
  if (kilde === "rapport") {
    return "Rapport";
  }
  if (kilde === "manuell") {
    return "Manuell";
  }
  if (kilde === "database") {
    return "Database";
  }
  return "Ukjent";
}
