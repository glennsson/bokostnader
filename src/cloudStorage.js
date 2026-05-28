import { isCloudEnabled, supabase } from "./supabaseClient";

export async function getSessionUser() {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session?.user ?? null;
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

  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("kalkulator_data")
    .select("payload, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data?.payload) {
    return null;
  }

  return {
    ...data.payload,
    savedAt: data.updated_at ?? data.payload.savedAt,
  };
}

export async function saveCloudState(payload) {
  if (!supabase) {
    return;
  }

  const user = await getSessionUser();
  if (!user) {
    return;
  }

  const { error } = await supabase.from("kalkulator_data").upsert(
    {
      user_id: user.id,
      payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw error;
  }
}

export async function deleteCloudState() {
  if (!supabase) {
    return;
  }

  const user = await getSessionUser();
  if (!user) {
    return;
  }

  const { error } = await supabase.from("kalkulator_data").delete().eq("user_id", user.id);
  if (error) {
    throw error;
  }
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
