import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";
import { parseTilstandsrapportText } from "./tilstandsrapport-parse.js";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/pdf,application/json,*/*",
  "Accept-Language": "nb-NO,nb;q=0.9,no;q=0.8",
};

const TILSTAND_KEYWORDS = [
  "tilstandsrapport",
  "tilstandsvurdering",
  "boligsalgsrapport",
  "tilstandsgrad",
  "tg-rapport",
  "tg rapport",
  "boligrapport",
  "last ned",
  "vis rapport",
  "se rapport",
  "anticimex",
  "boligprofil",
];

function isPdfUrl(url) {
  const lower = url.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.includes(".pdf?") ||
    lower.includes("/pdf/") ||
    lower.includes("application/pdf")
  );
}

export async function parsePdfBuffer(buffer) {
  const parsed = await pdfParse(buffer);
  return parsed.text ?? "";
}

async function fetchPdfText(pdfUrl) {
  const response = await fetch(pdfUrl, {
    headers: FETCH_HEADERS,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Kunne ikke laste PDF (HTTP ${response.status}). Prøv «Last opp PDF» i stedet for lenke.`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length < 100) {
    throw new Error("PDF-filen var tom eller kunne ikke hentes.");
  }

  if (!contentType.includes("pdf") && !isPdfUrl(pdfUrl) && buffer[0] !== 0x25) {
    throw new Error(
      "Lenken peker ikke til en PDF-fil. Lim inn direkte PDF-lenke eller last opp filen.",
    );
  }

  return parsePdfBuffer(buffer);
}

async function findPdfLinkInHtml(pageUrl, html) {
  const $ = cheerio.load(html);
  const candidates = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const label = ($(element).text() ?? "").toLowerCase();
    if (!href) {
      return;
    }

    try {
      const absolute = new URL(href, pageUrl).href;
      const haystack = `${absolute} ${label}`.toLowerCase();
      if (
        isPdfUrl(absolute) ||
        TILSTAND_KEYWORDS.some((kw) => haystack.includes(kw))
      ) {
        candidates.push({
          url: absolute,
          score: isPdfUrl(absolute) ? 10 : 5,
        });
      }
    } catch {
      // ignore
    }
  });

  return candidates.sort((a, b) => b.score - a.score)[0]?.url ?? null;
}

async function fetchHtmlBodyText(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: FETCH_HEADERS,
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Kunne ikke åpne siden (HTTP ${response.status}).`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ");

  if (bodyText.length < 80) {
    const pdfLink = await findPdfLinkInHtml(pageUrl, html);
    if (pdfLink && isPdfUrl(pdfLink)) {
      const pdfText = await fetchPdfText(pdfLink);
      return { text: pdfText, type: "pdf", url: pdfLink };
    }
  }

  return { text: bodyText, type: "html", url: pageUrl };
}

export function findTilstandsrapportLinks($, pageUrl) {
  const candidates = [];
  const seen = new Set();

  const addLink = (href, label = "") => {
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      return;
    }

    try {
      const absolute = new URL(href, pageUrl).href;
      if (seen.has(absolute)) {
        return;
      }

      const haystack = `${absolute} ${label}`.toLowerCase();
      const matchedKeyword = TILSTAND_KEYWORDS.some((keyword) =>
        haystack.includes(keyword),
      );

      if (!matchedKeyword && !isPdfUrl(absolute)) {
        return;
      }

      seen.add(absolute);
      candidates.push({
        url: absolute,
        score: matchedKeyword ? 10 : 5,
        type: isPdfUrl(absolute) ? "pdf" : "html",
      });
    } catch {
      // ugyldig URL
    }
  };

  $("a[href]").each((_, element) => {
    addLink($(element).attr("href"), $(element).text());
  });

  $("[data-href], iframe[src], embed[src]").each((_, element) => {
    addLink($(element).attr("data-href") ?? $(element).attr("src"), "rapport");
  });

  return candidates.sort((a, b) => b.score - a.score);
}

async function fetchDocumentText(url) {
  if (isPdfUrl(url)) {
    const text = await fetchPdfText(url);
    return { text, type: "pdf", url };
  }

  return fetchHtmlBodyText(url);
}

function buildParseFailureMessage(parsed, textLength) {
  const { tgHits } = parsed.debug ?? {};
  return (
    `Fant ${tgHits ?? 0} TG-markeringer i ${textLength} tegn med tekst, men ingen kostnadsestimat. ` +
    "Lim inn delen med kostnadstabell fra PDF-en, eller bruk «Last opp PDF»."
  );
}

/**
 * Henter og parser tilstandsrapport fra URL, opplastet PDF (base64) eller limt tekst.
 */
export async function extractTilstandsrapport({ url, text, pdfBase64 }) {
  if (pdfBase64 && typeof pdfBase64 === "string") {
    const buffer = Buffer.from(pdfBase64, "base64");
    const pdfText = await parsePdfBuffer(buffer);
    if (!pdfText || pdfText.length < 50) {
      throw new Error(
        "PDF-en ble lest, men inneholdet er tomt. Sjekk at filen er en vanlig tilstandsrapport (ikke skannet bilde uten tekst).",
      );
    }
    const parsed = parseTilstandsrapportText(pdfText);
    if (!parsed.found) {
      throw new Error(buildParseFailureMessage(parsed, pdfText.length));
    }
    return {
      ...parsed,
      kilde: "pdf_opplasting",
      dokumentUrl: null,
      dokumentType: "pdf",
    };
  }

  if (text && typeof text === "string" && text.trim().length >= 40) {
    const parsed = parseTilstandsrapportText(text);
    if (!parsed.found) {
      throw new Error(buildParseFailureMessage(parsed, text.length));
    }
    return {
      ...parsed,
      kilde: "limt_inn",
      dokumentUrl: null,
      dokumentType: "tekst",
    };
  }

  if (!url || typeof url !== "string") {
    throw new Error("Mangler URL, PDF-opplasting eller limt tekst.");
  }

  const trimmed = url.trim();

  let doc;
  try {
    doc = await fetchDocumentText(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} Tips: Last opp PDF-filen direkte.`);
  }

  if (!doc?.text || doc.text.length < 50) {
    throw new Error(
      "Fant ikke lesbar tekst på lenken. Mange rapporter krever innlogging – last opp PDF-filen direkte i stedet.",
    );
  }

  const parsed = parseTilstandsrapportText(doc.text);
  if (!parsed.found) {
    throw new Error(buildParseFailureMessage(parsed, doc.text.length));
  }

  return {
    ...parsed,
    kilde: "url",
    dokumentUrl: doc.url,
    dokumentType: doc.type,
  };
}
