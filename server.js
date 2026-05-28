import cors from "cors";
import express from "express";
import { extractFinnListing } from "./lib/finn-extract.js";
import { extractTilstandsrapport } from "./lib/tilstandsrapport-extract.js";

const app = express();
const port = 8787;

app.use(cors());
app.use(express.json());

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

app.post("/api/tilstandsrapport/parse", async (req, res) => {
  const { url, text } = req.body ?? {};

  try {
    const payload = await extractTilstandsrapport({ url, text });
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

app.listen(port, () => {
  console.log(`API kjører på http://localhost:${port}`);
});
