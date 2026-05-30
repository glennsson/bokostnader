import { parsePdfBuffer } from "./tilstandsrapport-extract.js";
import { parseTilstandsrapportText } from "./tilstandsrapport-parse.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

const BUCKET = "tilstandsrapport";
const PDF_PARSE_TIMEOUT_MS = 60_000;

function buildParseFailureMessage(parsed, textLength) {
  const { tgHits } = parsed.debug ?? {};
  return (
    `Fant ${tgHits ?? 0} TG-markeringer i ${textLength} tegn med tekst, men ingen kostnadsestimat. ` +
    "Lim inn delen med kostnadstabell fra PDF-en, eller bruk «Last opp PDF»."
  );
}

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function markJobFailed(admin, jobId, message) {
  const { error } = await admin
    .from("tilstandsrapport_jobs")
    .update({
      status: "failed",
      error_message: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    console.error(`[tilstandsrapport] Kunne ikke sette failed for jobb ${jobId}:`, error.message);
  }
}

export async function processTilstandsrapportJob(jobId) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY mangler på serveren.");
  }

  try {
    const { data: job, error: jobError } = await admin
      .from("tilstandsrapport_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      throw new Error(jobError?.message ?? "Fant ikke jobb.");
    }

    if (job.status === "completed") {
      return job.result;
    }

    if (job.status === "failed") {
      throw new Error(job.error_message ?? "Parsing feilet tidligere.");
    }

    await admin
      .from("tilstandsrapport_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    const { data: fileData, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(job.storage_path);

    if (downloadError) {
      throw downloadError;
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    const text = await withTimeout(
      parsePdfBuffer(buffer),
      PDF_PARSE_TIMEOUT_MS,
      `PDF-parsing tok for lang tid (timeout etter ${PDF_PARSE_TIMEOUT_MS / 1000} sekunder).`,
    );
    console.log("Ekstrahert tekst:", (text ?? "").substring(0, 300));

    if (!text || text.trim().length < 50) {
      throw new Error(
        "PDF-en ble lest, men inneholdet er tomt. Sjekk at filen er en vanlig tilstandsrapport (ikke skannet bilde uten tekst).",
      );
    }

    const parsed = await withTimeout(
      Promise.resolve(parseTilstandsrapportText(text)),
      PDF_PARSE_TIMEOUT_MS,
      `Tolkning av rapport tok for lang tid (timeout etter ${PDF_PARSE_TIMEOUT_MS / 1000} sekunder).`,
    );

    if (!parsed.found) {
      throw new Error(buildParseFailureMessage(parsed, text.length));
    }

    const result = {
      found: parsed.found,
      tiltak: parsed.tiltak,
      maintenancePlan: parsed.maintenancePlan,
      sumNodvendig: parsed.sumNodvendig,
      sumUmiddelbar: parsed.sumUmiddelbar,
      sumTotal: parsed.sumTotal,
      sumAnbefalt: parsed.sumAnbefalt,
      kilde: "pdf_storage",
    };

    if (job.property_id) {
      await syncMaintenanceCosts(admin, job, parsed);
    }

    const { error: updateError } = await admin
      .from("tilstandsrapport_jobs")
      .update({
        status: "completed",
        result,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateError) {
      throw updateError;
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tilstandsrapport] Jobb ${jobId} feilet:`, message);
    await markJobFailed(admin, jobId, message);
    throw error;
  }
}

async function syncMaintenanceCosts(admin, job, enriched) {
  await admin.from("maintenance_costs").delete().eq("job_id", job.id);

  const rows = (enriched.maintenancePlan ?? []).map((item) => ({
    user_id: job.user_id,
    property_id: job.property_id,
    job_id: job.id,
    omrade: item.omrade,
    tg: item.tg,
    belop: item.belop,
    planlagt_aar: item.planlagtAar,
    nodvendig: item.nodvendig,
    kilde: item.kildeBelop,
    beskrivelse: item.beskrivelse ?? "",
  }));

  if (rows.length === 0) {
    return;
  }

  const { error } = await admin.from("maintenance_costs").insert(rows);
  if (error) {
    throw error;
  }
}
