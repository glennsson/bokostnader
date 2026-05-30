import { extractTilstandsrapport } from "./tilstandsrapport-extract.js";
import { getSupabaseAdmin } from "./supabase-admin.js";

const BUCKET = "tilstandsrapport";

export async function processTilstandsrapportJob(jobId) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY mangler på serveren.");
  }

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

  await admin
    .from("tilstandsrapport_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    const { data: fileData, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(job.storage_path);

    if (downloadError) {
      throw downloadError;
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const pdfBase64 = buffer.toString("base64");

    const parsed = await extractTilstandsrapport({ pdfBase64 });

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
    await admin
      .from("tilstandsrapport_jobs")
      .update({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
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
