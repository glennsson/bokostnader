import React, { useState } from "react";
import { isCloudEnabled } from "./supabaseClient";
import { sendLoginLink, signOutCloud } from "./cloudStorage";

export default function AuthPanel({ user, onAuthChange }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isCloudEnabled) {
    return (
      <section className="auth-panel auth-panel-muted">
        <h2>Sky-lagring</h2>
        <p>
          For å lagre i skyen må du koble til Supabase (gratis). Se{" "}
          <code>supabase/SETUP.md</code> eller <code>DEPLOY-GUIDE.txt</code>.
        </p>
      </section>
    );
  }

  const handleLogin = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      setStatus("Skriv inn e-postadressen din.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      await sendLoginLink(email);
      setStatus("Sjekk e-posten din – vi har sendt en innloggingslenke.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Kunne ikke sende innloggingslenke.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setStatus("");
    try {
      await signOutCloud();
      onAuthChange(null);
      setStatus("Du er utlogget. Data lagres lokalt i nettleseren.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Kunne ikke logge ut.");
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <section className="auth-panel">
        <h2>Sky-lagring</h2>
        <p className="auth-user">
          Innlogget som <strong>{user.email}</strong>
        </p>
        <p className="auth-hint">Kalkulatoren synkroniseres automatisk til skyen mens du er innlogget.</p>
        <button type="button" className="button" onClick={handleLogout} disabled={busy}>
          Logg ut
        </button>
        {status ? <p className="auth-status">{status}</p> : null}
      </section>
    );
  }

  return (
    <section className="auth-panel">
      <h2>Sky-lagring</h2>
      <p>Logg inn med e-post for å lagre kalkulatoren på tvers av enheter.</p>
      <form className="auth-form" onSubmit={handleLogin}>
        <label className="field">
          <span>E-post</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="din@epost.no"
            autoComplete="email"
            required
          />
        </label>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Sender …" : "Send innloggingslenke"}
        </button>
      </form>
      {status ? <p className="auth-status">{status}</p> : null}
    </section>
  );
}
