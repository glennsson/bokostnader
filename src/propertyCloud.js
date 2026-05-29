import { extractFinnkode } from "../lib/finn-extract.js";
import { getSessionUser } from "./cloudStorage";
import { isCloudEnabled, supabase } from "./supabaseClient";

function isMissingTableError(error) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * Lagrer/oppdaterer eiendom i Supabase etter FINN-import.
 * @returns {Promise<string|null>} property id
 */
export async function upsertPropertyFromFinn({ finnUrl, finnData, adresse = "", role = "" }) {
  if (!isCloudEnabled || !supabase || !finnUrl?.trim()) {
    return null;
  }

  let user;
  try {
    user = await getSessionUser();
  } catch {
    return null;
  }

  if (!user) {
    return null;
  }

  const url = finnUrl.trim();
  const finnkode = finnData?.finnkode ?? extractFinnkode(url);
  const now = new Date().toISOString();

  const row = {
    adresse: adresse?.trim() || null,
    finn_url: url,
    boligpris: finnData?.boligpris ?? null,
    felleskostnader_mnd: finnData?.felleskostnaderMnd ?? 0,
    metadata: {
      finnkode,
      role,
      utdatert: finnData?.utdatert ?? false,
      hentetFra: finnData?.hentetFra ?? null,
      kilde: finnData?.kilde ?? null,
      salgsoppgaveFunnet: finnData?.salgsoppgaveFunnet ?? false,
      salgsoppgaveUrl: finnData?.salgsoppgaveUrl ?? null,
      tilstandsrapportFunnet: finnData?.tilstandsrapportFunnet ?? false,
      kommunaleAarlig: finnData?.kommunaleAarlig ?? null,
      vedlikeholdAarlig: finnData?.vedlikeholdAarlig ?? null,
      driftAarlig: finnData?.driftAarlig ?? null,
    },
    updated_at: now,
  };

  try {
    if (finnkode) {
      const { data: byCode } = await supabase
        .from("properties")
        .select("id")
        .eq("user_id", user.id)
        .eq("metadata->>finnkode", String(finnkode))
        .maybeSingle();

      if (byCode?.id) {
        const { error } = await supabase
          .from("properties")
          .update(row)
          .eq("id", byCode.id);
        if (error) {
          throw error;
        }
        return byCode.id;
      }
    }

    const { data: byUrl } = await supabase
      .from("properties")
      .select("id")
      .eq("user_id", user.id)
      .eq("finn_url", url)
      .maybeSingle();

    if (byUrl?.id) {
      const { error } = await supabase.from("properties").update(row).eq("id", byUrl.id);
      if (error) {
        throw error;
      }
      return byUrl.id;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("properties")
      .insert({ ...row, user_id: user.id })
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    return inserted?.id ?? null;
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Lagrer scenario-kopi knyttet til eiendom (hvis tabellen finnes).
 */
export async function saveScenarioToCloud({ navn, payload, propertyId = null }) {
  if (!isCloudEnabled || !supabase) {
    return null;
  }

  const user = await getSessionUser();
  if (!user) {
    return null;
  }

  const now = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("scenarios")
      .insert({
        user_id: user.id,
        property_id: propertyId,
        navn: navn || "Scenario",
        payload,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return data?.id ?? null;
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }
    throw error;
  }
}
