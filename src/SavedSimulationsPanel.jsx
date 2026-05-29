import React, { useEffect, useState } from "react";
import { isCloudEnabled } from "./supabaseClient";
import { useSavedSimulations } from "./useSavedSimulations";
import {
  formatSimulationCurrency,
  formatSimulationDate,
} from "./savedSimulationsFormat";

export default function SavedSimulationsPanel({
  user,
  onOpen,
  onViewAll,
  refreshToken = 0,
  variant = "sidebar",
  hideHeader = false,
}) {
  const { rows, loading, error, refresh } = useSavedSimulations(user);
  const [openingId, setOpeningId] = useState(null);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken, user?.id]);

  const handleOpen = async (row) => {
    if (!row?.payload) {
      return;
    }

    setOpeningId(row.id);
    try {
      await onOpen(row.payload, row);
    } finally {
      setOpeningId(null);
    }
  };

  const title = "Lagrede simuleringer";

  const emptyHint = !isCloudEnabled
    ? "Sky-lagring er ikke satt opp (.env)."
    : !user
      ? "Logg inn for å lagre flere simuleringer i skyen."
      : "Ingen lagringer ennå. Trykk «Lagre nå» for å opprette en simulering.";

  if (variant === "top") {
    return (
      <section className="simulations-top" aria-label={title}>
        {!hideHeader ? (
          <div className="simulations-top-header">
            <h2 className="simulations-heading">{title}</h2>
            <div className="simulations-top-actions">
              <button
                type="button"
                className="button button-small"
                onClick={() => void refresh()}
                disabled={loading}
              >
                Oppdater
              </button>
              {onViewAll ? (
                <button type="button" className="button button-small" onClick={onViewAll}>
                  Vis alle
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="simulations-top-header simulations-top-header--tools">
            <button
              type="button"
              className="button button-small"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Oppdater liste
            </button>
          </div>
        )}

        {error ? <p className="simulations-error">{error}</p> : null}

        {loading ? (
          <p className="hint simulations-hint">Henter lagringer …</p>
        ) : rows.length === 0 ? (
          <p className="hint simulations-hint">{emptyHint}</p>
        ) : (
          <div className="table-wrap simulations-table-wrap">
            <table className="data-table simulations-table">
              <thead>
                <tr>
                  <th scope="col">Dato</th>
                  <th scope="col">Navn</th>
                  <th scope="col" className="num">
                    Mnd.
                  </th>
                  <th scope="col" className="num">
                    Åpne
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="simulations-date">
                        {formatSimulationDate(row.updated_at ?? row.created_at)}
                      </span>
                      {row.isAutolagret ? (
                        <span className="simulations-badge">Auto</span>
                      ) : null}
                      {row.isLocalOnly ? (
                        <span className="simulations-badge simulations-badge--local">
                          Lokal
                        </span>
                      ) : null}
                    </td>
                    <td>{row.navn}</td>
                    <td className="num">{formatSimulationCurrency(row.total_maanedlig)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="button button-primary button-small"
                        onClick={() => handleOpen(row)}
                        disabled={openingId === row.id}
                      >
                        {openingId === row.id ? "…" : "Åpne"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <aside className="simulations-sidebar" aria-label={title}>
      <div className="simulations-sidebar-header">
        <h2 className="simulations-heading">{title}</h2>
        <button
          type="button"
          className="button button-small"
          onClick={() => void refresh()}
          disabled={loading}
          title="Oppdater liste"
        >
          ↻
        </button>
      </div>

      {error ? <p className="simulations-error">{error}</p> : null}

      {loading ? (
        <p className="hint simulations-hint">Henter …</p>
      ) : rows.length === 0 ? (
        <p className="hint simulations-hint">{emptyHint}</p>
      ) : (
        <ul className="simulations-list" role="list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="simulations-list-item"
                onClick={() => handleOpen(row)}
                disabled={openingId === row.id}
              >
                <span className="simulations-list-name">{row.navn}</span>
                <span className="simulations-list-meta">
                  {formatSimulationCurrency(row.total_maanedlig)} / mnd
                </span>
                <span className="simulations-list-date">
                  {formatSimulationDate(row.updated_at ?? row.created_at)}
                  {row.isAutolagret ? " · autolagret" : ""}
                  {row.isLocalOnly ? " · kun lokalt" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {onViewAll ? (
        <button type="button" className="button simulations-view-all" onClick={onViewAll}>
          Vis full oversikt
        </button>
      ) : null}

      {!user && isCloudEnabled ? (
        <p className="hint simulations-sidebar-foot">
          Logg inn over for å synkronisere simuleringer på tvers av enheter.
        </p>
      ) : null}
    </aside>
  );
}
