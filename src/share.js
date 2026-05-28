export function encodeShareState(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeShareState(encoded) {
  if (!encoded) {
    return null;
  }

  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

export function readShareFromUrl() {
  const encoded = new URLSearchParams(window.location.search).get("d");
  if (!encoded) {
    return null;
  }

  try {
    return decodeShareState(encoded);
  } catch {
    return null;
  }
}

export function buildShareUrl(state) {
  const encoded = encodeShareState(state);
  const url = new URL(window.location.href);
  url.searchParams.set("d", encoded);
  return url.toString();
}
