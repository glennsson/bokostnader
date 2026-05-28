import { extractTilstandsrapport } from "../../lib/tilstandsrapport-extract.js";

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Kun POST er støttet." });
    return;
  }

  const { url, text } = request.body ?? {};

  try {
    const payload = await extractTilstandsrapport({ url, text });
    response.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Mangler") ? 400 : 500;
    response.status(status).json({
      error: status === 400 ? message : "Feil ved parsing av tilstandsrapport.",
      details: message,
    });
  }
}
