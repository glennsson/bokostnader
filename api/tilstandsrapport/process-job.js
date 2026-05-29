import { processTilstandsrapportJob } from "../../lib/tilstandsrapport-job-process.js";
import { isSupabaseAdminConfigured } from "../../lib/supabase-admin.js";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Kun POST er støttet." });
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    response.status(503).json({
      error: "Server mangler SUPABASE_SERVICE_ROLE_KEY.",
      details: "Legg nøkkelen i .env.local (lokalt) og Vercel Environment Variables.",
    });
    return;
  }

  const { jobId } = request.body ?? {};

  if (!jobId) {
    response.status(400).json({ error: "Mangler jobId." });
    return;
  }

  try {
    const result = await processTilstandsrapportJob(jobId);
    response.status(200).json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({
      error: "Parsing feilet.",
      details: message,
    });
  }
}
