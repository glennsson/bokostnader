import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";
import { mergeExtractedData, parseSalgsoppgaveText } from "./salgsoppgave-parse.js";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/pdf,*/*",
};

const SALGSOPPGAVE_KEYWORDS = [
  "salgsoppgave",
  "salgsoppg",
  "prospekt",
  "megleroppgave",
  "weboppgave",
  "eiendomsinfo",
  "vis salgsoppgave",
  "last ned salgsoppgave",
  "se salgsoppgave",
  "boliginfo",
];

function isPdfUrl(url) {
  const lower = url.toLowerCase();
  return lower.endsWith(".pdf") || lower.includes(".pdf?") || lower.includes("/pdf/");
}

function scoreSalgsoppgaveLink(url, label = "") {
  const urlLower = url.toLowerCase();
  const labelLower = label.toLowerCase();
  let score = 0;

  for (const keyword of SALGSOPPGAVE_KEYWORDS) {
    if (labelLower.includes(keyword)) {
      score += 12;
    }
    if (urlLower.includes(keyword)) {
      score += 8;
    }
  }

  if (isPdfUrl(url)) {
    score += 3;
  } else if (urlLower.startsWith("http")) {
    score += 5;
  }

  return score;
}

/** Finn lenker til salgsoppgave (PDF eller ekstern nettside). */
export function findSalgsoppgaveLinks($, pageUrl) {
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

      const score = scoreSalgsoppgaveLink(absolute, label);
      if (score < 5) {
        return;
      }

      seen.add(absolute);
      candidates.push({
        url: absolute,
        score,
        type: isPdfUrl(absolute) ? "pdf" : "html",
      });
    } catch {
      // ugyldig URL
    }
  };

  $("a[href]").each((_, element) => {
    addLink($(element).attr("href"), $(element).text());
  });

  $("[data-href]").each((_, element) => {
    addLink($(element).attr("data-href"), $(element).text());
  });

  $("iframe[src]").each((_, element) => {
    addLink($(element).attr("src"), "salgsoppgave");
  });

  return candidates.sort((a, b) => b.score - a.score);
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

async function fetchHtmlText(pageUrl) {
  const response = await fetch(pageUrl, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("pdf")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await pdfParse(buffer);
    return { text: parsed.text ?? "", $: null, finalUrl: pageUrl, type: "pdf" };
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");

  return { text, $, finalUrl: pageUrl, type: "html" };
}

async function extractFromSalgsoppgaveLink(link, depth = 0) {
  const maxDepth = 2;

  try {
    if (link.type === "pdf" || isPdfUrl(link.url)) {
      const pdfText = await fetchPdfText(link.url);
      if (pdfText && pdfText.length >= 150) {
        const parsed = parseSalgsoppgaveText(pdfText);
        if (parsed.found) {
          return { ...parsed, salgsoppgaveUrl: link.url, salgsoppgaveType: "pdf" };
        }
      }
      return null;
    }

    const page = await fetchHtmlText(link.url);
    if (!page?.text) {
      return null;
    }

    let parsed = parseSalgsoppgaveText(page.text);
    if (parsed.found) {
      return { ...parsed, salgsoppgaveUrl: page.finalUrl, salgsoppgaveType: "html" };
    }

    if (depth < maxDepth && page.$) {
      const nestedLinks = findSalgsoppgaveLinks(page.$, page.finalUrl).slice(0, 3);
      for (const nested of nestedLinks) {
        if (nested.url === link.url) {
          continue;
        }
        const nestedResult = await extractFromSalgsoppgaveLink(nested, depth + 1);
        if (nestedResult) {
          return nestedResult;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function extractFinnListing(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Mangler gyldig URL.");
  }

  const response = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Klarte ikke hente URL (${response.status}).`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const htmlText = $("body").text().replace(/\s+/g, " ");
  const fromFinn = parseSalgsoppgaveText(htmlText);

  const salgsoppgaveLinks = findSalgsoppgaveLinks($, url);
  let fromSalgsoppgave = null;

  for (const link of salgsoppgaveLinks.slice(0, 5)) {
    fromSalgsoppgave = await extractFromSalgsoppgaveLink(link);
    if (fromSalgsoppgave) {
      break;
    }
  }

  const merged = mergeExtractedData(
    fromSalgsoppgave ?? { found: false },
    fromFinn,
  );

  let kilde = "ingen_data";
  if (fromSalgsoppgave && fromFinn.found) {
    kilde = "salgsoppgave_og_finn";
  } else if (fromSalgsoppgave) {
    kilde = fromSalgsoppgave.salgsoppgaveType === "pdf" ? "salgsoppgave_pdf" : "salgsoppgave_nettside";
  } else if (fromFinn.found) {
    kilde = "finn_side";
  }

  return {
    ...merged,
    salgsoppgaveFunnet: Boolean(fromSalgsoppgave),
    salgsoppgaveUrl: fromSalgsoppgave?.salgsoppgaveUrl ?? null,
    salgsoppgaveType: fromSalgsoppgave?.salgsoppgaveType ?? null,
    kilde,
    funnet: Object.keys(merged).length > 0,
  };
}
