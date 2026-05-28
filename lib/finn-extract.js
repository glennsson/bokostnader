import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";
import { mergeExtractedData, parseSalgsoppgaveText } from "./salgsoppgave-parse.js";
import {
  extractTilstandsrapport,
  findTilstandsrapportLinks,
} from "./tilstandsrapport-extract.js";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/pdf,application/json,*/*",
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

const INACTIVE_FINN_MARKERS =
  /ikke lenger aktiv|utgått|utgatt|deaktivert|denne annonsen er|annonsen er avsluttet|solgt/i;

export function extractFinnkode(url) {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("finnkode");
    if (fromQuery) {
      return fromQuery;
    }
  } catch {
    // ignore
  }

  const match =
    url.match(/finnkode[=:](\d+)/i) ??
    url.match(/\/realestate\/homes\/ad\/(\d+)/i) ??
    url.match(/\/(\d{8,})(?:[/?#]|$)/);
  return match?.[1] ?? null;
}

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

function deepFindFinnFields(obj, depth = 0, found = {}) {
  if (depth > 22 || !obj || typeof obj !== "object") {
    return found;
  }

  const label = String(obj.label ?? obj.key ?? obj.name ?? obj.title ?? "").toLowerCase();

  if (found.boligpris == null) {
    if (typeof obj.price === "number" && obj.price > 50000) {
      found.boligpris = obj.price;
    } else if (typeof obj.amount === "number" && /pris|price|salgs/i.test(label)) {
      found.boligpris = obj.amount;
    } else if (obj.offers?.price) {
      found.boligpris = Number(obj.offers.price);
    }
  }

  if (found.felleskostnaderMnd == null) {
    const monthly =
      obj.monthlyCost ?? obj.monthly ?? obj.recurringMonthly ?? obj.commonCost;
    if (typeof monthly === "number" && /felles/i.test(label)) {
      found.felleskostnaderMnd = monthly;
    }
  }

  if (found.kommunaleAarlig == null && /kommunal|eiendomsskatt/i.test(label)) {
    const value = obj.amount ?? obj.yearly ?? obj.value;
    if (typeof value === "number") {
      found.kommunaleAarlig = value;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      deepFindFinnFields(value, depth + 1, found);
    }
  }

  return found;
}

function parseEmbeddedFinnJson(html) {
  const fields = deepFindFinnFields({});

  const nextMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      Object.assign(fields, deepFindFinnFields(JSON.parse(nextMatch[1])));
    } catch {
      // ignore
    }
  }

  const $ = cheerio.load(html);
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() ?? "");
      Object.assign(fields, deepFindFinnFields(parsed));
    } catch {
      // ignore
    }
  });

  if (fields.boligpris == null) {
    const priceMatch = html.match(/"price"\s*:\s*(\d{5,})/);
    if (priceMatch) {
      fields.boligpris = Number(priceMatch[1]);
    }
  }

  fields.found = [
    fields.boligpris,
    fields.felleskostnaderMnd,
    fields.kommunaleAarlig,
    fields.vedlikeholdAarlig,
    fields.driftAarlig,
  ].some((value) => value != null);

  return fields;
}

async function fetchUrlLoose(url) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    const html = await response.text();
    if (!html || html.length < 80) {
      return null;
    }

    const $ = cheerio.load(html);
    return {
      html,
      $,
      finalUrl: response.url || url,
      ok: response.ok,
      status: response.status,
      inactive: INACTIVE_FINN_MARKERS.test(html),
    };
  } catch {
    return null;
  }
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
  const page = await fetchUrlLoose(pageUrl);
  if (!page) {
    return null;
  }

  return {
    text: page.$("body").text().replace(/\s+/g, " "),
    $: page.$,
    finalUrl: page.finalUrl,
    type: "html",
  };
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

async function tryFinnApi(finnkode) {
  const endpoints = [
    `https://www.finn.no/api/realestate-homes/v1/ad/${finnkode}`,
    `https://www.finn.no/realestate/homes/ad/deactivated.html?finnkode=${finnkode}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: FETCH_HEADERS, redirect: "follow" });
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        const json = await response.json();
        const fields = deepFindFinnFields(json);
        if (fields.boligpris || fields.felleskostnaderMnd) {
          return { ...fields, found: true };
        }
      } else {
        const html = await response.text();
        const parsed = parseSalgsoppgaveText(cheerio.load(html)("body").text().replace(/\s+/g, " "));
        if (parsed.found) {
          return parsed;
        }
        const embedded = parseEmbeddedFinnJson(html);
        if (embedded.found) {
          return embedded;
        }
      }
    } catch {
      // prøv neste
    }
  }

  return null;
}

async function fetchWaybackPage(originalUrl) {
  try {
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(originalUrl)}&output=json&filter=statuscode:200&limit=-1`;
    const cdxRes = await fetch(cdxUrl, { headers: FETCH_HEADERS });
    if (!cdxRes.ok) {
      return null;
    }

    const rows = await cdxRes.json();
    if (!Array.isArray(rows) || rows.length < 2) {
      return null;
    }

    const timestamp = rows[rows.length - 1][1];
    const snapshotUrl = `https://web.archive.org/web/${timestamp}id_/${originalUrl}`;
    return fetchUrlLoose(snapshotUrl);
  } catch {
    return null;
  }
}

async function extractFromPage(page) {
  const fromEmbedded = parseEmbeddedFinnJson(page.html);
  const fromText = parseSalgsoppgaveText(page.$("body").text().replace(/\s+/g, " "));

  let fromSalgsoppgave = null;
  const salgsoppgaveLinks = findSalgsoppgaveLinks(page.$, page.finalUrl);
  for (const link of salgsoppgaveLinks.slice(0, 5)) {
    fromSalgsoppgave = await extractFromSalgsoppgaveLink(link);
    if (fromSalgsoppgave) {
      break;
    }
  }

  let fromTilstandsrapport = null;
  const tilstandLinks = findTilstandsrapportLinks(page.$, page.finalUrl);
  for (const link of tilstandLinks.slice(0, 3)) {
    try {
      const parsed = await extractTilstandsrapport({ url: link.url });
      if (parsed.found) {
        fromTilstandsrapport = parsed;
        break;
      }
    } catch {
      // prøv neste lenke
    }
  }

  return { fromEmbedded, fromText, fromSalgsoppgave, fromTilstandsrapport };
}

export async function extractFinnListing(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Mangler gyldig URL.");
  }

  const finnkode = extractFinnkode(url);
  const listingUrl = finnkode
    ? `https://www.finn.no/realestate/homes/ad.html?finnkode=${finnkode}`
    : url.trim();

  const hentetFra = [];
  let page = await fetchUrlLoose(listingUrl);
  let inactive = false;

  if (page) {
    inactive = page.inactive;
    hentetFra.push(inactive ? "utgått FINN-side" : "FINN-side");
  }

  let { fromEmbedded, fromText, fromSalgsoppgave, fromTilstandsrapport } = page
    ? await extractFromPage(page)
    : {
        fromEmbedded: { found: false },
        fromText: { found: false },
        fromSalgsoppgave: null,
        fromTilstandsrapport: null,
      };

  const apiData = finnkode ? await tryFinnApi(finnkode) : null;
  if (apiData?.found) {
    hentetFra.push("FINN lagret annonsedata");
  }

  let merged = mergeExtractedData(
    fromSalgsoppgave ?? { found: false },
    fromEmbedded?.found ? fromEmbedded : { found: false },
    fromText,
    apiData ?? { found: false },
  );

  if (Object.keys(merged).length === 0 || (inactive && !merged.boligpris)) {
    const wayback = await fetchWaybackPage(listingUrl);
    if (wayback) {
      const waybackExtract = await extractFromPage(wayback);
      merged = mergeExtractedData(
        waybackExtract.fromSalgsoppgave ?? { found: false },
        waybackExtract.fromEmbedded?.found ? waybackExtract.fromEmbedded : { found: false },
        waybackExtract.fromText,
        merged,
      );
      if (Object.keys(merged).length > 0) {
        hentetFra.push("Internet Archive (arkivert kopi)");
        inactive = true;
      }
    }
  }

  if (!page && !apiData && Object.keys(merged).length === 0) {
    throw new Error(
      "Klarte ikke hente annonsen. Sjekk at lenken er riktig, eller at salgsoppgave fortsatt er tilgjengelig.",
    );
  }

  let kilde = "ingen_data";
  if (fromSalgsoppgave && Object.keys(merged).length > 0) {
    kilde = inactive ? "utgaatt_og_salgsoppgave" : "salgsoppgave_og_finn";
  } else if (Object.keys(merged).length > 0) {
    kilde = inactive ? "utgaatt_finn" : "finn_side";
  }

  return {
    ...merged,
    finnkode,
    utdatert: inactive,
    hentetFra: hentetFra.join(" · ") || kilde,
    salgsoppgaveFunnet: Boolean(fromSalgsoppgave),
    salgsoppgaveUrl: fromSalgsoppgave?.salgsoppgaveUrl ?? null,
    salgsoppgaveType: fromSalgsoppgave?.salgsoppgaveType ?? null,
    tilstandsrapport: fromTilstandsrapport,
    tilstandsrapportFunnet: Boolean(fromTilstandsrapport?.found),
    kilde,
    funnet: Object.keys(merged).length > 0,
  };
}
