import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";
import { parseTilstandsrapportText } from "./tilstandsrapport-parse.js";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/pdf,application/json,*/*",
};

const TILSTAND_KEYWORDS = [
  "tilstandsrapport",
  "tilstandsvurdering",
  "boligsalgsrapport",
  "tilstandsgrad",
  "tg-rapport",
  "tg rapport",
  "last ned tilstandsrapport",
  "vis tilstandsrapport",
  "se tilstandsrapport",
];

function isPdfUrl(url) {
  const lower = url.toLowerCase();
  return lower.endsWith(".pdf") || lower.includes(".pdf?") || lower.includes("/pdf/");
}

async function fetchPdfText(pdfUrl) {
  const response = await fetch(pdfUrl, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("pdf") && !isPdfUrl(pdfUrl)) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = await pdfParse(buffer);
  return parsed.text ?? "";
}

async function fetchHtmlBodyText(pageUrl) {
  const response = await fetch(pageUrl, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  return cheerio.load(html)("body").text().replace(/\s+/g, " ");
}

export function findTilstandsrapportLinks($, pageUrl) {
  const candidates = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const label = $(element).text() ?? "";
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }

    try {
      const absolute = new URL(href, pageUrl).href;
      if (seen.has(absolute)) {
        return;
      }

      const haystack = `${absolute} ${label}`.toLowerCase();
      const matched = TILSTAND_KEYWORDS.some((keyword) => haystack.includes(keyword));
      if (!matched && !isPdfUrl(absolute)) {
        return;
      }
      if (!matched && isPdfUrl(absolute)) {
        return;
      }

      seen.add(absolute);
      candidates.push({
        url: absolute,
        score: matched ? 10 : 3,
        type: isPdfUrl(absolute) ? "pdf" : "html",
      });
    } catch {
      // ugyldig URL
    }
  });

  return candidates.sort((a, b) => b.score - a.score);
}

async function fetchDocumentText(url) {
  if (isPdfUrl(url)) {
    return { text: await fetchPdfText(url), type: "pdf", url };
  }

  const htmlText = await fetchHtmlBodyText(url);
  return { text: htmlText, type: "html", url };
}

/**
 * Henter og parser tilstandsrapport fra URL (PDF/HTML) eller rå tekst.
 */
export async function extractTilstandsrapport({ url, text }) {
  if (text && typeof text === "string" && text.trim().length >= 80) {
    const parsed = parseTilstandsrapportText(text);
    return {
      ...parsed,
      kilde: "limt_inn",
      dokumentUrl: null,
      dokumentType: "tekst",
    };
  }

  if (!url || typeof url !== "string") {
    throw new Error("Mangler URL eller tekst fra tilstandsrapport.");
  }

  const trimmed = url.trim();
  const doc = await fetchDocumentText(trimmed);
  if (!doc?.text || doc.text.length < 80) {
    throw new Error(
      "Fant ikke lesbar tilstandsrapport på lenken. Prøv PDF-lenke eller lim inn tekst fra rapporten.",
    );
  }

  const parsed = parseTilstandsrapportText(doc.text);
  if (!parsed.found) {
    throw new Error(
      "Dokumentet ble hentet, men ingen kostnadsestimat per område ble gjenkjent. Lim inn relevant del av PDF-en.",
    );
  }

  return {
    ...parsed,
    kilde: "url",
    dokumentUrl: doc.url,
    dokumentType: doc.type,
  };
}
