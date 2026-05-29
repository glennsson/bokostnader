import { requireAuthUser } from "./cloudStorage";
import { supabase, isCloudEnabled } from "./supabaseClient";

const BUCKET = "tilstandsrapport";

export function canUseAsyncTilstandsrapport() {
  return isCloudEnabled && Boolean(supabase);
}

export async function uploadAndQueueTilstandsrapport(
  file,
  { homeContext, propertyId = null } = {},
) {
  if (!canUseAsyncTilstandsrapport()) {
    throw new Error("Sky-lagring er ikke tilgjengelig.");
  }

  const user = await requireAuthUser();
  const jobId = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-æøåÆØÅ ]/gi, "_");
  const storagePath = `${user.id}/${jobId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: job, error: insertError } = await supabase
    .from("tilstandsrapport_jobs")
    .insert({
      id: jobId,
      user_id: user.id,
      storage_path: storagePath,
      file_name: file.name,
      status: "processing",
      property_id: propertyId,
      home_context: homeContext,
    })
    .select("id, status")
    .single();

  if (insertError) {
    throw insertError;
  }

  void triggerProcessJob(job.id);

  return job;
}

async function triggerProcessJob(jobId) {
  try {
    await fetch("/api/tilstandsrapport/process-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
  } catch {
    // Realtime vil fortsatt vise feilet status hvis server ikke svarer
  }
}

export function subscribeTilstandsrapportJob(jobId, { onUpdate, onError }) {
  if (!supabase) {
    return () => {};
  }

  const channel = supabase
    .channel(`tilstandsrapport-job-${jobId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "tilstandsrapport_jobs",
        filter: `id=eq.${jobId}`,
      },
      (payload) => {
        const row = payload.new;
        onUpdate?.(row);
      },
    )
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR") {
        onError?.(err ?? new Error("Realtime-kanal feilet."));
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
