import dotenv from "dotenv";
import cors from "cors";
import express from "express";

dotenv.config({ path: ".env.local" });
dotenv.config();
import { extractFinnListing } from "./lib/finn-extract.js";
import { extractTilstandsrapport } from "./lib/tilstandsrapport-extract.js";
import { processTilstandsrapportJob } from "./lib/tilstandsrapport-job-process.js";
import { isSupabaseAdminConfigured } from "./lib/supabase-admin.js";

const app = express();
const port = 8787;

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.post("/api/finn/extract", async (req, res) => {
  const { url } = req.body ?? {};

  try {
    const payload = await extractFinnListing(url);
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Mangler") ? 400 : 500;
    res.status(status).json({
      error: status === 400 ? message : "Feil ved henting/parsing av annonsen.",
      details: message,
    });
  }
});

app.post("/api/tilstandsrapport/process-job", async (req, res) => {
  const { jobId } = req.body ?? {};

  if (!jobId) {
    res.status(400).json({ error: "Mangler jobId." });
    return;
  }

  if (!isSupabaseAdminConfigured()) {
    res.status(503).json({
      error: "Server mangler SUPABASE_SERVICE_ROLE_KEY i .env.local",
    });
    return;
  }

  try {
    const result = await processTilstandsrapportJob(jobId);
    res.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "Parsing feilet.", details: message });
  }
});

app.post("/api/tilstandsrapport/parse", async (req, res) => {
  const { url, text, pdfBase64 } = req.body ?? {};

  try {
    const payload = await extractTilstandsrapport({ url, text, pdfBase64 });
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Mangler") ? 400 : 500;
    res.status(status).json({
      error: status === 400 ? message : "Feil ved parsing av tilstandsrapport.",
      details: message,
    });
  }
});

const server = app.listen(port, () => {
  console.log(`API kjører på http://localhost:${port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `\nPort ${port} er allerede i bruk. Kjør «npm run dev» på nytt – porten frigjøres automatisk.\n` +
        `Eller stopp manuelt: node scripts/free-port.mjs ${port}\n`,
    );
    process.exit(1);
  }

  throw error;
});
