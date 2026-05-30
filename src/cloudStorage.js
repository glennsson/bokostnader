import { getSnapshotMeta } from "./snapshotMeta";
import { isCloudEnabled, supabase } from "./supabaseClient";

export function formatSupabaseError(error) {
  if (!error) {
    return "Ukjent feil mot Supabase.";
  }

  const parts = [error.message, error.details, error.hint].filter(Boolean);
  const base = parts.join(" – ") || "Ukjent feil mot Supabase.";

  if (error.code === "42P01" || error.code === "PGRST205") {
    return `${base} Kjør supabase/01-kalkulator-grunnlag.sql i Supabase (tabell kalkulator_data mangler).`;
  }

  if (error.code === "42501") {
    return `${base} Sjekk Row Level Security-policies i Supabase.`;
  }

  if (/bucket not found/i.test(base)) {
    return `${base} Kjør supabase/02-tilstandsrapport-pdf-bucket.sql i Supabase SQL Editor (Storage-bucket «tilstandsrapport» mangler).`;
  }

  if (/invalid key/i.test(base)) {
    return `${base} Filnavnet inneholder tegn Storage ikke støtter (æ, ø, å, mellomrom). Prøv på nytt – appen konverterer nå til ASCII automatisk.`;
  }

  return base;
}

/** Henter innlogget bruker (getUser er mer pålitelig enn getSession alene). */
export async function getSessionUser() {
  if (!supabase) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw sessionError;
  }

  if (sessionData.session?.user) {
    return sessionData.session.user;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    throw userError;
  }

  return userData.user ?? null;
}

export async function requireAuthUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Du er ikke innlogget. Bruk e-postlenken i «Sky-lagring» først.");
  }
  return user;
}

export async function sendLoginLink(email) {
  if (!supabase) {
    throw new Error("Sky-lagring er ikke konfigurert.");
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) {
    throw error;
  }
}

export async function signOutCloud() {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function loadCloudState() {
  if (!supabase) {
    return null;
  }

  const user = await requireAuthUser();

  const { data, error } = await supabase
    .from("kalkulator_data")
    .select("payload, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.payload == null) {
    return null;
  }

  return {
    ...data.payload,
    savedAt: data.updated_at ?? data.payload.savedAt,
  };
}

/**
 * Lagrer kalkulator til Supabase (UPSERT på user_id).
 * Kaster feil ved manglende innlogging eller database-feil.
 */
export async function saveToSupabase(payload) {
  if (!supabase) {
    throw new Error("Sky-lagring er ikke konfigurert (mangler VITE_SUPABASE_* i .env).");
  }

  const user = await requireAuthUser();
  const row = {
    user_id: user.id,
    payload,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("kalkulator_data")
    .upsert(row, { onConflict: "user_id" })
    .select("user_id, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return {
    userId: data.user_id,
    updatedAt: data.updated_at,
  };
}

/** @deprecated Bruk saveToSupabase */
export const saveCloudState = saveToSupabase;

export async function deleteCloudState() {
  if (!supabase) {
    return;
  }

  const user = await requireAuthUser();

  const { error } = await supabase.from("kalkulator_data").delete().eq("user_id", user.id);
  if (error) {
    throw error;
  }
}

export async function listCloudSnapshots() {
  if (!supabase) {
    return [];
  }

  const user = await requireAuthUser();
  const rows = [];

  const { data: current, error: currentError } = await supabase
    .from("kalkulator_data")
    .select("payload, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (currentError) {
    throw currentError;
  }

  if (current?.payload != null) {
    const meta = getSnapshotMeta(current.payload);
    rows.push({
      id: "current",
      navn: meta.navn,
      total_maanedlig: meta.totalMaanedlig,
      created_at: current.updated_at,
      updated_at: current.updated_at,
      payload: current.payload,
      isAutolagret: true,
    });
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("kalkulator_snapshots")
    .select("id, navn, total_maanedlig, payload, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (snapshotsError) {
    if (snapshotsError.code === "42P01" || snapshotsError.code === "PGRST205") {
      return rows;
    }
    throw snapshotsError;
  }

  for (const item of snapshots ?? []) {
    rows.push({
      id: item.id,
      navn: item.navn,
      total_maanedlig: Number(item.total_maanedlig),
      created_at: item.created_at,
      updated_at: item.updated_at,
      payload: item.payload,
      isAutolagret: false,
    });
  }

  return rows;
}

export async function saveCloudSnapshot(payload) {
  if (!supabase) {
    return null;
  }

  const user = await requireAuthUser();
  const meta = getSnapshotMeta(payload);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("kalkulator_snapshots")
    .insert({
      user_id: user.id,
      navn: meta.navn,
      total_maanedlig: meta.totalMaanedlig,
      payload,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return null;
    }
    throw error;
  }

  return data?.id ?? null;
}

export function subscribeToAuth(callback) {
  if (!isCloudEnabled || !supabase) {
    return () => {};
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session?.user ?? null);
  });

  return () => subscription.unsubscribe();
}
