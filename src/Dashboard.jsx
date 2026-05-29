import React from "react";
import { isCloudEnabled } from "./supabaseClient";
import SavedSimulationsPanel from "./SavedSimulationsPanel";

export default function Dashboard({ user, onOpen, onBack, refreshToken = 0 }) {
  if (!isCloudEnabled) {
    return (
      <section className="dashboard">
        <header className="dashboard-header">
          <h2>Mine lagringer</h2>
          {onBack ? (
            <button type="button" className="button" onClick={onBack}>
              Tilbake til kalkulator
            </button>
          ) : null}
        </header>
        <p className="hint">Sky-lagring er ikke konfigurert. Sett opp Supabase i `.env`.</p>
      </section>
    );
  }

  return (
    <section className="dashboard">
      <header className="dashboard-header">
        <div>
          <h2>Mine lagringer</h2>
          {user ? (
            <p className="hint">Alle lagrede kalkulatorer knyttet til {user.email}</p>
          ) : (
            <p>Logg inn med e-post for å se lagrede kalkulatorer i skyen.</p>
          )}
        </div>
        {onBack ? (
          <button type="button" className="button button-primary" onClick={onBack}>
            Tilbake til kalkulator
          </button>
        ) : null}
      </header>

      <SavedSimulationsPanel
        user={user}
        onOpen={onOpen}
        variant="top"
        hideHeader
        refreshToken={refreshToken}
      />
    </section>
  );
}
