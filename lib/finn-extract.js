import * as cheerio from "cheerio";

function parseAmount(text) {
  if (!text) {
    return null;
  }

  const normalized = String(text)
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function firstNumberByPattern(text, pattern) {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  return parseAmount(match[1]);
}

function extractFromJsonLd($) {
  let extracted = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    try {
      const parsed = JSON.parse(raw);
      const maybeList = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of maybeList) {
        const offer = item?.offers ?? item?.mainEntity?.offers;
        if (offer?.price) {
          extracted = { ...extracted, boligpris: parseAmount(offer.price) };
        }
      }
    } catch {
      // ignore invalid JSON-LD snippets
    }
  });
  return extracted;
}

function extractFromHtmlText(fullText) {
  return {
    boligpris:
      firstNumberByPattern(fullText, /Prisantydning[^0-9]{0,30}([\d\s.,]+)/i) ??
      firstNumberByPattern(fullText, /Totalpris[^0-9]{0,30}([\d\s.,]+)/i),
    felleskostnaderMnd:
      firstNumberByPattern(fullText, /Felleskostnader[^0-9]{0,30}([\d\s.,]+)/i) ??
      firstNumberByPattern(fullText, /Fellesutgifter[^0-9]{0,30}([\d\s.,]+)/i),
    kommunaleAarlig: firstNumberByPattern(
      fullText,
      /Kommunale avgifter[^0-9]{0,30}([\d\s.,]+)/i,
    ),
  };
}

export async function extractFinnListing(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Mangler gyldig URL.");
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Klarte ikke hente URL (${response.status}).`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");

  const jsonLdData = extractFromJsonLd($);
  const textData = extractFromHtmlText(text);

  return {
    boligpris: jsonLdData.boligpris ?? textData.boligpris ?? null,
    felleskostnaderMnd: textData.felleskostnaderMnd ?? null,
    kommunaleAarlig: textData.kommunaleAarlig ?? null,
    source: url,
  };
}
