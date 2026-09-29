// ── Reading a spreadsheet nobody prepared ─────────────────────────
// The owner uploads the Excel file as it came — a directory export, a
// scraped list, a client's CRM dump — and this works out which column is
// the email, which the company, which the phone, cleans what it finds, and
// says exactly what it kept and what it threw away. Column detection is by
// header name first and by the look of the values second, because half the
// files have no usable headers.

import { promises as dns } from "node:dns";

export interface ImportRow {
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  industry?: string;
  city?: string;
}

export interface ImportReport {
  rows: ImportRow[];
  total: number;
  kept: number;
  invalid: number;
  duplicates: number;
  roleAddresses: number;       // info@, sales@ … kept, but counted
  columns: Record<string, string | null>;
  sample: ImportRow[];
}

const EMAIL_RE = /^[a-z0-9._%+\-']+@([a-z0-9-]+\.)+[a-z]{2,}$/i;
const ROLE_LOCAL = /^(info|sales|admin|contact|support|hello|office|accounts|hr|marketing|noreply|no-reply|enquiry|enquiries|inquiry|help|mail)$/i;

// Header words, in the languages the files come in.
const H = {
  email:    /^(e-?mail|البريد|الايميل|الإيميل|ايميل|إيميل|بريد|mail)/i,
  name:     /^(name|full ?name|contact|الاسم|اسم|المسؤول|person|owner|manager|مدير)/i,
  company:  /^(company|business|firm|organi[sz]ation|الشركة|شركة|المنشأة|المؤسسة|اسم الشركة|trade ?name|establishment)/i,
  phone:    /^(phone|mobile|tel|whatsapp|الهاتف|هاتف|جوال|الجوال|رقم|موبايل|واتساب)/i,
  industry: /^(industry|activity|sector|category|type|النشاط|نشاط|القطاع|قطاع|التصنيف|المجال)/i,
  city:     /^(city|emirate|location|area|المدينة|مدينة|الإمارة|إمارة|الموقع|المنطقة)/i,
};

export function normalizeEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/^mailto:/, "").replace(/[<>()\[\]"'\s]/g, "");
  if (!EMAIL_RE.test(s)) return null;
  if (s.length > 254) return null;
  return s;
}

export function isRoleAddress(email: string): boolean {
  return ROLE_LOCAL.test(email.split("@")[0]!);
}

function looksLikePhone(v: unknown): boolean {
  const s = String(v ?? "").replace(/[\s\-\+\(\)\.]/g, "");
  return /^\d{7,15}$/.test(s);
}

/**
 * Decide which column is which. Headers win when they say something; the
 * values decide otherwise (a column where most cells contain @ is the email
 * column whatever it is called).
 */
export function detectColumns(rows: Array<Record<string, unknown>>): Record<keyof ImportRow, string | null> {
  const out: Record<keyof ImportRow, string | null> = { email: null, name: null, company: null, phone: null, industry: null, city: null };
  if (!rows.length) return out;
  const headers = Object.keys(rows[0]!);

  // "اسم الشركة" starts with "اسم", so company is tried before name.
  const ORDER: Array<keyof typeof H> = ["company", "email", "phone", "industry", "city", "name"];
  for (const k of ORDER) {
    for (const h of headers) {
      if (out[k]) break;
      if (H[k].test(h.trim()) && !Object.values(out).includes(h)) out[k] = h;
    }
  }

  const sample = rows.slice(0, 200);
  const score = (h: string, f: (v: unknown) => boolean) => sample.filter((r) => f(r[h])).length / sample.length;
  if (!out.email) {
    const best = headers.map((h) => [h, score(h, (v) => !!normalizeEmail(v))] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 0.3) out.email = best[0];
  }
  if (!out.phone) {
    const best = headers.filter((h) => h !== out.email).map((h) => [h, score(h, looksLikePhone)] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 0.5) out.phone = best[0];
  }
  if (!out.company) {
    // The widest text column that is not the email, phone or name.
    const taken = new Set([out.email, out.phone, out.name, out.industry, out.city].filter(Boolean));
    const best = headers.filter((h) => !taken.has(h))
      .map((h) => [h, sample.reduce((a, r) => a + String(r[h] ?? "").length, 0)] as const)
      .sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) out.company = best[0];
  }
  return out;
}

/** Clean the rows: valid emails, one per address, with what else the file said about them. */
export function cleanRows(rows: Array<Record<string, unknown>>, columns = detectColumns(rows)): ImportReport {
  const seen = new Set<string>();
  const kept: ImportRow[] = [];
  let invalid = 0, duplicates = 0, roles = 0;
  const str = (r: Record<string, unknown>, k: string | null) => (k ? String(r[k] ?? "").trim().slice(0, 200) || undefined : undefined);

  for (const r of rows) {
    const email = columns.email ? normalizeEmail(r[columns.email]) : null;
    if (!email) { invalid++; continue; }
    if (seen.has(email)) { duplicates++; continue; }
    seen.add(email);
    if (isRoleAddress(email)) roles++;
    const phone = str(r, columns.phone)?.replace(/[\s\-\+\(\)\.]/g, "").replace(/^00/, "");
    kept.push({
      email,
      name: str(r, columns.name), company: str(r, columns.company),
      phone: phone && /^\d{7,15}$/.test(phone) ? phone : undefined,
      industry: str(r, columns.industry), city: str(r, columns.city),
    });
  }
  return { rows: kept, total: rows.length, kept: kept.length, invalid, duplicates, roleAddresses: roles, columns, sample: kept.slice(0, 5) };
}

/** Group by a field for auto-splitting into lists. Unlabelled rows go under "غير محدد". */
export function splitBy(rows: ImportRow[], field: "industry" | "city"): Map<string, ImportRow[]> {
  const m = new Map<string, ImportRow[]>();
  for (const r of rows) {
    const k = (r[field] ?? "").trim() || "غير محدد";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/**
 * Does the domain accept mail at all? A domain with no MX (and no A) record
 * bounces everything, and a bounce is the one thing a new sending address
 * cannot afford. Cached per domain for the run; a lookup failure is "unknown"
 * rather than "bad".
 */
export async function checkMx(domains: Iterable<string>, concurrency = 8): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const list = [...new Set(domains)];
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const d = list[i++]!;
      try {
        const mx = await dns.resolveMx(d);
        if (mx.length) { out.set(d, true); continue; }
        const a = await dns.resolve4(d).catch(() => []);
        out.set(d, a.length > 0);
      } catch (err: any) {
        const code = err?.code;
        out.set(d, code === "ENOTFOUND" || code === "ENODATA" ? false : null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return out;
}
