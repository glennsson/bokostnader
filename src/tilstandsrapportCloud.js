import { formatSupabaseError, requireAuthUser } from "./cloudStorage";
import { supabase, isCloudEnabled } from "./supabaseClient";

const BUCKET = "tilstandsrapport";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

/** Supabase Storage tillater bare ASCII i object keys (æ/ø/å og mellomrom feiler). */
export function toStorageSafeFileName(fileName) {
  const base = String(fileName ?? "tilstandsrapport.pdf")
    .replace(/[/\\]/g, "_")
    .trim();

  let ascii = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/å/gi, "a")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);

  if (!ascii) {
    return "tilstandsrapport.pdf";
  }
  if (!/\.pdf$/i.test(ascii)) {
    ascii = `${ascii}.pdf`;
  }
  return ascii;
}

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
  const safeName = toStorageSafeFileName(file.name);
  const storagePath = `${user.id}/${jobId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(formatSupabaseError(uploadError));
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
    // Polling-fallback plukker opp status selv om serverkall feiler
  }
}

export async function fetchTilstandsrapportJob(jobId) {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("tilstandsrapport_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

function isTerminalJobStatus(status) {
  return status === "completed" || status === "failed";
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
        onUpdate?.(payload.new);
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

/**
 * Realtime + polling-fallback – oppdaterer selv om Replication ikke er slått på.
 */
export function watchTilstandsrapportJob(
  jobId,
  {
    onUpdate,
    onError,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  } = {},
) {
  let stopped = false;
  let pollTimer = null;
  let finished = false;
  const startedAt = Date.now();

  const handleRow = (row) => {
    if (!row || finished) {
      return;
    }

    onUpdate?.(row);

    if (isTerminalJobStatus(row.status)) {
      finished = true;
      stop();
    }
  };

  const unsubscribeRealtime = subscribeTilstandsrapportJob(jobId, {
    onUpdate: handleRow,
    onError,
  });

  const pollOnce = async () => {
    if (stopped || finished) {
      return;
    }

    if (Date.now() - startedAt > pollTimeoutMs) {
      finished = true;
      stop();
      onError?.(
        new Error(
          "Ingen svar fra parsing innen 2 minutter. Sjekk at API-serveren kjører og at SUPABASE_SERVICE_ROLE_KEY er satt.",
        ),
      );
      return;
    }

    try {
      const row = await fetchTilstandsrapportJob(jobId);
      handleRow(row);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  void pollOnce();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, pollIntervalMs);

  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    unsubscribeRealtime();
  }

  return stop;
}
