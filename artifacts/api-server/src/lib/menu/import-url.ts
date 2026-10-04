// ── A fourth door: the shop's own menu link ───────────────────────
// Many shops already have their menu somewhere — a page on their site, a
// PDF, an image link. The owner pastes the link; the page is fetched once,
// its text (and any schema.org menu data) read, and the model turns it into
// the same draft a photo gives, for the owner to check before saving.
//
// The server fetches only what the owner typed, and only from the public
// internet: every address is resolved and checked, every redirect again,
// so a link cannot be used to reach the server's own network.

import { lookup } from "node:dns/promises";
import net from "node:net";

export class UrlImportError extends Error {}

/** Private, loopback, link-local, carrier-grade and metadata ranges. Pure. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

/** A link the owner typed, made a URL we may fetch, or a reason why not. Pure. */
export function cleanMenuUrl(raw: unknown): URL {
  const s = String(raw ?? "").trim();
  // Another scheme (ftp://, file://, …) is refused, not mistaken for a host.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) throw new UrlImportError("الرابط يجب أن يبدأ بـ https");
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { throw new UrlImportError("الرابط غير صحيح"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UrlImportError("الرابط يجب أن يبدأ بـ https");
  if (u.username || u.password) throw new UrlImportError("الرابط غير صحيح");
  if (u.port && u.port !== "80" && u.port !== "443") throw new UrlImportError("هذا الرابط غير مدعوم");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new UrlImportError("هذا الرابط غير مدعوم");
  if (net.isIP(host) && isPrivateAddress(host)) throw new UrlImportError("هذا الرابط غير مدعوم");
  return u;
}

async function assertPublic(u: URL) {
  const addrs = await lookup(u.hostname, { all: true }).catch(() => { throw new UrlImportError("لم نصل لهذا الموقع — تأكد من الرابط"); });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new UrlImportError("هذا الرابط غير مدعوم");
}

const MAX_BYTES = 4 * 1024 * 1024;

/** Fetch the page (following up to 3 redirects, each checked), at most 4 MB. */
export async function fetchMenuPage(raw: unknown): Promise<{ buf: Buffer; type: string; url: string }> {
  let u = cleanMenuUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(u);
    const r = await fetch(u, {
      redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MenuForYouImport/1.0)", Accept: "text/html,application/pdf,image/*;q=0.9,*/*;q=0.5" },
    }).catch(() => { throw new UrlImportError("لم نصل لهذا الموقع — تأكد من الرابط"); });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = cleanMenuUrl(new URL(r.headers.get("location")!, u).toString()); continue; }
    if (!r.ok) throw new UrlImportError(`الموقع ردّ بخطأ (${r.status})`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new UrlImportError("الصفحة كبيرة جداً");
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new UrlImportError("الصفحة كبيرة جداً"); }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks), type: (r.headers.get("content-type") ?? "").toLowerCase(), url: u.toString() };
  }
  throw new UrlImportError("الرابط يحوّل كثيراً");
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** A page's readable text: schema.org menu data first, then the visible words. Pure. */
export function pageText(html: string): string {
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!.trim())
    .filter((j) => /Menu|offers|price/i.test(j)).join("\n").slice(0, 15_000);
  const body = decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return [ld ? `بيانات منظمة:\n${ld}` : "", body].filter(Boolean).join("\n\n").slice(0, 30_000);
}
