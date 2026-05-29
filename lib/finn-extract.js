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

/** Kun tydelige «utgått»-tekster i hovedinnhold – ikke hele HTML (unngår JS-bundle med «solgt»/«deaktivert»). */
const INACTIVE_MAIN_TEXT_MARKERS =
  /annonsen er ikke lenger aktiv|ikke lenger tilgjengelig|denne annonsen er avsluttet|annonsen er deaktivert|denne boligen er solgt/i;

function parseKrAmount(text) {
  if (!text) {
    return null;
  }
  const normalized = String(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 100) {
    return null;
  }
  return Math.round(value);
}

/**
 * FINN viser ofte «Prisantydning9 900 000 kr» uten mellomrom mellom etikett og tall.
 */
function parseFinnVisibleKeyInfo(rawText) {
  const text = rawText.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const fields = {};

  const pick = (pattern) => {
    const match = text.match(pattern);
    return match ? parseKrAmount(match[1]) : null;
  };

  fields.boligpris =
    pick(/Prisantydning\s*([\d\s.,]+)\s*kr/i) ??
    pick(/Pris\s*([\d\s.,]+)\s*kr/i);

  fields.totalpris = pick(/Totalpris\s*([\d\s.,]+)\s*kr/i);
  fields.omkostninger = pick(/Omkostninger\s*([\d\s.,]+)\s*kr/i);
  fields.felleskostnaderMnd = pick(/Felleskostnader\s*([\d\s.,]+)\s*kr/i);
  fields.fellesgjeld = pick(/Fellesgjeld\s*([\d\s.,]+)\s*kr/i);

  const kommunale = pick(/Kommunale avg\.?\s*([\d\s.,]+)\s*kr/i);
  if (kommunale != null) {
    fields.kommunaleAarlig = kommunale;
  }

  const eiendomsskatt = pick(/Eiendomsskatt\s*([\d\s.,]+)\s*kr/i);
  if (eiendomsskatt != null && fields.kommunaleAarlig != null) {
    fields.kommunaleAarlig += eiendomsskatt;
  } else if (eiendomsskatt != null) {
    fields.kommunaleAarlig = eiendomsskatt;
  }

  fields.found = [
    fields.boligpris,
    fields.felleskostnaderMnd,
    fields.kommunaleAarlig,
    fields.fellesgjeld,
    fields.omkostninger,
  ].some((v) => v != null);

  return fields;
}

/** Parser FINN key-info (dl/dt/dd og div-baserte rader). */
function parseFinnDlKeyInfo($) {
  const fields = {};
  const setByLabel = (label, valueText) => {
    const amount = parseKrAmount(valueText);
    if (amount == null) {
      return;
    }
    const lower = label.toLowerCase();

    if (/prisantydning|^pris$/.test(lower)) {
      fields.boligpris = amount;
    } else if (/totalpris/.test(lower)) {
      fields.totalpris = amount;
    } else if (/omkostninger/.test(lower)) {
      fields.omkostninger = amount;
    } else if (/felleskostnader/.test(lower)) {
      fields.felleskostnaderMnd = amount;
    } else if (/fellesgjeld/.test(lower)) {
      fields.fellesgjeld = amount;
    } else if (/kommunale/.test(lower)) {
      fields.kommunaleAarlig = (fields.kommunaleAarlig ?? 0) + amount;
    } else if (/eiendomsskatt/.test(lower)) {
      fields.kommunaleAarlig = (fields.kommunaleAarlig ?? 0) + amount;
    }
  };

  $("dl dt").each((_, dt) => {
    const label = $(dt).text().trim();
    const dd = $(dt).next("dd").text().trim();
    if (label && dd) {
      setByLabel(label, dd);
    }
  });

  $('[data-testid="key-info"] dt, section[aria-label*="Pris"] dt').each((_, dt) => {
    const label = $(dt).text().trim();
    const dd = $(dt).next("dd").text().trim();
    if (label && dd) {
      setByLabel(label, dd);
    }
  });

  fields.found = [
    fields.boligpris,
    fields.felleskostnaderMnd,
    fields.kommunaleAarlig,
    fields.fellesgjeld,
    fields.omkostninger,
  ].some((v) => v != null);

  return fields;
}

function detectInactiveFinnPage(page, extracted = {}) {
  if (!page) {
    return false;
  }

  if (page.finalUrl?.includes("deactivated")) {
    return true;
  }

  const $ = page.$;
  const mainText = (
    $("main").text() ||
    $('[data-testid="ad-page"]').text() ||
    $("article").text() ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  if (INACTIVE_MAIN_TEXT_MARKERS.test(mainText)) {
    return true;
  }

  if (
    extracted.boligpris > 50000 ||
    /prisantydning/i.test(mainText) ||
    parseFinnVisibleKeyInfo(mainText).boligpris > 50000
  ) {
    return false;
  }

  if (page.status === 404 || page.status === 410) {
    return true;
  }

  return false;
}

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
    if (typeof obj.askingPrice === "number" && obj.askingPrice > 50000) {
      found.boligpris = obj.askingPrice;
    } else if (typeof obj.price === "number" && obj.price > 50000) {
      found.boligpris = obj.price;
    } else if (obj.price?.amount > 50000) {
      found.boligpris = obj.price.amount;
    } else if (typeof obj.amount === "number" && /pris|price|salgs/i.test(label)) {
      found.boligpris = obj.amount;
    } else if (obj.offers?.price) {
      found.boligpris = Number(obj.offers.price);
    }
  }

  if (found.omkostninger == null && /omkostning/i.test(label)) {
    const value = obj.amount ?? obj.value;
    if (typeof value === "number") {
      found.omkostninger = value;
    }
  }

  if (found.fellesgjeld == null && /fellesgjeld/i.test(label)) {
    const value = obj.amount ?? obj.value;
    if (typeof value === "number") {
      found.fellesgjeld = value;
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

function parseEmbeddedFinnJson(html, $existing) {
  const fields = deepFindFinnFields({});

  const nextMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch) {
    try {
      Object.assign(fields, deepFindFinnFields(JSON.parse(nextMatch[1])));
    } catch {
      // ignore
    }
  }

  const $ = $existing ?? cheerio.load(html);
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() ?? "");
      Object.assign(fields, deepFindFinnFields(parsed));
    } catch {
      // ignore
    }
  });

  Object.assign(fields, parseFinnDlKeyInfo($));

  const visible = parseFinnVisibleKeyInfo($("body").text());
  for (const key of [
    "boligpris",
    "felleskostnaderMnd",
    "kommunaleAarlig",
    "fellesgjeld",
    "omkostninger",
    "totalpris",
  ]) {
    if (fields[key] == null && visible[key] != null) {
      fields[key] = visible[key];
    }
  }

  if (fields.boligpris == null) {
    const priceMatch =
      html.match(/"askingPrice"\s*:\s*(\d{5,})/) ??
      html.match(/"price"\s*:\s*\{\s*"amount"\s*:\s*(\d{5,})/) ??
      html.match(/"price"\s*:\s*(\d{5,})/);
    if (priceMatch) {
      fields.boligpris = Number(priceMatch[1]);
    }
  }

  fields.found = [
    fields.boligpris,
    fields.felleskostnaderMnd,
    fields.kommunaleAarlig,
    fields.fellesgjeld,
    fields.omkostninger,
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
      inactive: false,
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
  const fromEmbedded = parseEmbeddedFinnJson(page.html, page.$);
  const bodyText = page.$("body").text().replace(/\s+/g, " ");
  const fromVisible = parseFinnVisibleKeyInfo(bodyText);
  const fromText = parseSalgsoppgaveText(bodyText);

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

  return { fromEmbedded, fromVisible, fromText, fromSalgsoppgave, fromTilstandsrapport };
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

  let { fromEmbedded, fromVisible, fromText, fromSalgsoppgave, fromTilstandsrapport } =
    page
      ? await extractFromPage(page)
      : {
          fromEmbedded: { found: false },
          fromVisible: { found: false },
          fromText: { found: false },
          fromSalgsoppgave: null,
          fromTilstandsrapport: null,
        };

  const apiData = finnkode ? await tryFinnApi(finnkode) : null;
  if (apiData?.found) {
    hentetFra.push("FINN lagret annonsedata");
  }

  let merged = mergeExtractedData(
    fromEmbedded?.found ? fromEmbedded : { found: false },
    fromVisible?.found ? fromVisible : { found: false },
    fromText,
    apiData ?? { found: false },
    fromSalgsoppgave ?? { found: false },
  );

  let inactive = detectInactiveFinnPage(page, merged);

  if (page) {
    hentetFra.push(inactive ? "utgått FINN-side" : "FINN-side");
  }

  if (merged.boligpris > 50000 && inactive && !page?.finalUrl?.includes("deactivated")) {
    inactive = false;
  }

  if (Object.keys(merged).length === 0 || (inactive && !merged.boligpris)) {
    const wayback = await fetchWaybackPage(listingUrl);
    if (wayback) {
      const waybackExtract = await extractFromPage(wayback);
      merged = mergeExtractedData(
        waybackExtract.fromSalgsoppgave ?? { found: false },
        waybackExtract.fromEmbedded?.found ? waybackExtract.fromEmbedded : { found: false },
        waybackExtract.fromVisible?.found ? waybackExtract.fromVisible : { found: false },
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
