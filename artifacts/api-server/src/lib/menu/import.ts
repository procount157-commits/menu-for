// ── Getting a menu in without typing it ───────────────────────────
// Three doors:
//   • a spreadsheet — read by its headers (Arabic or English), one row per item
//   • a photo or PDF of the paper menu — read by a vision model into items,
//     returned for the owner to check before anything is saved
//   • English names and descriptions written for the Arabic ones
//
// The model is never trusted with saving: a photo import returns a draft, and
// the editor saves what the owner keeps.

import * as XLSX from "xlsx";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, menuCategoriesTable, menuItemsTable } from "@workspace/db";
import type { Tenant } from "../tenancy/context";
import { complete, resolveProvider } from "../llm";
import { assertWithinLimit } from "../plans";
import { itemCount } from "./service";
import { logger } from "../logger";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/\s+/g, " ");

const HEAD: Record<string, string[]> = {
  name:          ["الاسم", "اسم الصنف", "الصنف", "اسم المنتج", "المنتج", "الخدمه", "اسم الخدمه", "الطبق", "name", "item", "product", "service", "dish", "name ar", "arabic name"],
  nameEn:        ["الاسم بالانجليزي", "الاسم الانجليزي", "english", "name en", "english name", "name_en"],
  price:         ["السعر", "سعر", "الثمن", "price", "cost", "amount"],
  category:      ["التصنيف", "القسم", "الفئه", "النوع", "category", "section", "group", "type"],
  description:   ["الوصف", "التفاصيل", "المكونات", "description", "details", "ingredients"],
  descriptionEn: ["الوصف بالانجليزي", "description en", "english description", "description_en"],
  duration:      ["المده", "مده الخدمه", "الوقت", "duration", "minutes", "time"],
  calories:      ["السعرات", "سعرات", "calories", "kcal"],
};

function headerMap(row: unknown[]): Record<string, number> | null {
  const m: Record<string, number> = {};
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    for (const [k, words] of Object.entries(HEAD)) {
      if (m[k] !== undefined) continue;
      if (words.some((w) => h === w || (w.length > 3 && h.includes(w)))) { m[k] = i; break; }
    }
  });
  // The English-name header also matches "name"; keep them apart.
  if (m.name !== undefined && m.name === m.nameEn) delete m.nameEn;
  return m.name !== undefined && m.price !== undefined ? m : null;
}

const toPrice = (v: unknown) => {
  const s = String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d.,]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

export interface ImportRow { category: string | null; name: string; nameEn: string | null; price: number; description: string | null; descriptionEn: string | null; durationMin: number | null; calories: number | null }

export function parseSheet(buf: Buffer): { rows: ImportRow[]; skipped: Array<{ row: number; why: string }> } {
  const wb = XLSX.read(buf, { type: "buffer", dense: true });
  const rows: ImportRow[] = [];
  const skipped: Array<{ row: number; why: string }> = [];
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, { header: 1, defval: "", blankrows: false, raw: true }) as unknown[][];
    let map: Record<string, number> | null = null;
    let start = 0;
    for (let i = 0; i < Math.min(15, grid.length); i++) { map = headerMap(grid[i]!); if (map) { start = i + 1; break; } }
    if (!map) continue;
    // A sheet named after a category ("الحلويات") is that category for rows without one.
    const sheetCat = wb.SheetNames.length > 1 ? sheetName.trim() : null;
    for (let r = start; r < grid.length; r++) {
      const g = grid[r]!;
      const name = String(g[map.name!] ?? "").trim();
      if (!name) continue;
      const price = toPrice(g[map.price!]);
      if (price === null) { skipped.push({ row: r + 1, why: `«${name}» بدون سعر صحيح` }); continue; }
      const cell = (k: string) => (map![k] === undefined ? "" : String(g[map![k]!] ?? "").trim());
      rows.push({
        category: cell("category") || sheetCat,
        name: name.slice(0, 160), nameEn: cell("nameEn").slice(0, 160) || null, price,
        description: cell("description").slice(0, 1200) || null, descriptionEn: cell("descriptionEn").slice(0, 1200) || null,
        durationMin: Number(cell("duration")) > 0 ? Math.round(Number(cell("duration"))) : null,
        calories: Number(cell("calories")) > 0 ? Math.round(Number(cell("calories"))) : null,
      });
    }
  }
  return { rows, skipped };
}

/** Save rows into the org's menu: categories made by name, items added (never replaced). */
export async function saveRows(t: Tenant, rows: ImportRow[]): Promise<{ categories: number; items: number }> {
  const have = await itemCount(t.org.id);
  if (rows.length) await assertWithinLimit(t.org.ownerUserId, "items", have + rows.length - 1);
  const cats = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, t.org.id));
  const byName = new Map(cats.map((c) => [norm(c.name), c.id]));
  let newCats = 0;
  let sort = cats.length;
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(sort), -1)::int` }).from(menuItemsTable).where(eq(menuItemsTable.orgId, t.org.id));
  let itemSort = m + 1;
  const kind = t.org.vertical === "beauty" ? "service" : "product";
  await db.transaction(async (tx) => {
    for (const r of rows) {
      let categoryId: number | null = null;
      if (r.category) {
        categoryId = byName.get(norm(r.category)) ?? null;
        if (!categoryId) {
          const [c] = await tx.insert(menuCategoriesTable).values({ orgId: t.org.id, name: r.category.slice(0, 120), sort: sort++ }).returning();
          categoryId = c!.id; byName.set(norm(r.category), c!.id); newCats++;
        }
      }
      await tx.insert(menuItemsTable).values({
        orgId: t.org.id, categoryId, kind, name: r.name, nameEn: r.nameEn, price: r.price.toFixed(2),
        description: r.description, descriptionEn: r.descriptionEn, durationMin: r.durationMin, calories: r.calories, sort: itemSort++,
      });
    }
  });
  return { categories: newCats, items: rows.length };
}

export async function importMenuFile(t: Tenant, buf: Buffer, fileName: string, opts: { dry: boolean }) {
  const { rows, skipped } = parseSheet(buf);
  if (!rows.length) {
    return { dry: true, rows: [], skipped, saved: null, error: "لم أجد عمودي «الاسم» و«السعر» في الملف — أضف صف عناوين فيه الاسم والسعر (والتصنيف اختيارياً)." };
  }
  if (opts.dry) return { dry: true, rows, skipped, saved: null };
  const saved = await saveRows(t, rows);
  logger.info({ orgId: t.org.id, fileName, ...saved }, "menu imported from sheet");
  return { dry: false, rows, skipped, saved };
}

// ── Photo / PDF ───────────────────────────────────────────────────

const VISION_PROMPT = `You are reading a restaurant/shop menu. Extract every item you can read.
Return ONLY a JSON array, no prose, no markdown fences. Each element:
{"category": string|null, "name": string, "nameEn": string|null, "price": number, "description": string|null}
Rules: keep names exactly as printed (Arabic stays Arabic); "nameEn" only if an English name is printed;
price is a number without currency; skip anything without a readable price; do not invent items.`;

function parseJsonArray(text: string): any[] {
  const s = text.replace(/```(?:json)?/gi, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try { const v = JSON.parse(s.slice(a, b + 1)); return Array.isArray(v) ? v : []; } catch { return []; }
}

function rowsFromModel(arr: any[]): ImportRow[] {
  return arr.map((x) => ({
    category: typeof x?.category === "string" && x.category.trim() ? x.category.trim().slice(0, 120) : null,
    name: String(x?.name ?? "").trim().slice(0, 160),
    nameEn: typeof x?.nameEn === "string" && x.nameEn.trim() ? x.nameEn.trim().slice(0, 160) : null,
    price: toPrice(x?.price) ?? -1,
    description: typeof x?.description === "string" && x.description.trim() ? x.description.trim().slice(0, 1200) : null,
    descriptionEn: null, durationMin: null, calories: null,
  })).filter((r) => r.name && r.price >= 0);
}

/** One vision call, through whichever configured provider can see. */
async function vision(dataUrl: string, prompt: string): Promise<string | null> {
  const env = (k: string) => process.env[k] ?? "";
  const tries: Array<() => Promise<string | null>> = [];
  const openaiShape = (url: string, key: string, model: string) => async () => {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 4000, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl } }] }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`${model} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    return j?.choices?.[0]?.message?.content ?? null;
  };
  if (env("ANTHROPIC_API_KEY")) tries.push(async () => {
    const [, mime, b64] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) ?? [];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env("ANTHROPIC_VISION_MODEL") || "claude-haiku-4-5", max_tokens: 4000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }, { type: "text", text: prompt }] }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const j: any = await r.json();
    return j?.content?.find((c: any) => c.type === "text")?.text ?? null;
  });
  if (env("GEMINI_API_KEY")) tries.push(async () => {
    const [, mime, b64] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) ?? [];
    const model = env("GEMINI_VISION_MODEL") || "gemini-flash-latest";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env("GEMINI_API_KEY")}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }], generationConfig: { temperature: 0 } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    const j: any = await r.json();
    return j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? null;
  });
  if (env("ZHIPU_API_KEY")) tries.push(openaiShape("https://open.bigmodel.cn/api/paas/v4/chat/completions", env("ZHIPU_API_KEY"), env("ZHIPU_VISION_MODEL") || "glm-4v-flash"));
  if (env("GROQ_API_KEY")) tries.push(openaiShape("https://api.groq.com/openai/v1/chat/completions", env("GROQ_API_KEY"), env("GROQ_VISION_MODEL") || "meta-llama/llama-4-scout-17b-16e-instruct"));
  if (env("OPENROUTER_API_KEY")) tries.push(openaiShape("https://openrouter.ai/api/v1/chat/completions", env("OPENROUTER_API_KEY"), env("OPENROUTER_VISION_MODEL") || "google/gemma-3-27b-it:free"));
  for (const t of tries) {
    try { const out = await t(); if (out && out.trim()) return out; }
    catch (err) { logger.warn({ err: String((err as Error)?.message ?? err) }, "menu vision attempt failed"); }
  }
  return null;
}

export async function importMenuFromImage(t: Tenant, buf: Buffer, mime: string, fileName: string) {
  let rows: ImportRow[] = [];
  if (mime === "application/pdf" || /\.pdf$/i.test(fileName)) {
    // A PDF with a text layer is read directly; the model only structures it.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const body = String(Array.isArray(text) ? text.join("\n") : text).slice(0, 30_000);
    if (body.trim().length < 20) return { rows: [], error: "هذا PDF صورة بدون نص — صوّر المنيو وارفع الصورة بدلاً منه." };
    const r = await complete([{ role: "system", content: VISION_PROMPT }, { role: "user", content: body }], 90_000);
    rows = rowsFromModel(parseJsonArray(r?.text ?? ""));
    if (!r) return { rows: [], error: "لا يوجد نموذج ذكاء مفعّل — أضف مفتاحاً من صفحة «معرفة البوت»." };
  } else {
    if (!/^image\//.test(mime)) return { rows: [], error: "ارفع صورة (JPG/PNG/WebP) أو ملف PDF" };
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const out = await vision(`data:image/jpeg;base64,${jpg.toString("base64")}`, VISION_PROMPT);
    if (out === null) return { rows: [], error: "تعذّرت قراءة الصورة — لا يوجد نموذج يدعم الصور، أو كلها مشغولة الآن. جرّب بعد قليل أو استخدم ملف Excel." };
    rows = rowsFromModel(parseJsonArray(out));
  }
  return { rows, error: rows.length ? null : "لم أستطع قراءة أصناف بأسعار من الملف — جرّب صورة أوضح." };
}

// ── English for the Arabic menu ───────────────────────────────────

export async function translateMenu(t: Tenant, opts: { onlyMissing: boolean }) {
  if (!(await resolveProvider())) return { translated: 0, error: "لا يوجد نموذج ذكاء مفعّل — أضف مفتاحاً من صفحة «معرفة البوت»." };
  const items = await db.select().from(menuItemsTable).where(and(
    eq(menuItemsTable.orgId, t.org.id),
    ...(opts.onlyMissing ? [or(isNull(menuItemsTable.nameEn), eq(menuItemsTable.nameEn, ""))!] : []),
  ));
  const cats = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.orgId, t.org.id));
  const todoCats = cats.filter((c) => !opts.onlyMissing || !c.nameEn);
  let done = 0;
  const batch = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  for (const group of batch(items, 25)) {
    const input = group.map((i) => ({ id: i.id, name: i.name, description: i.description ?? "" }));
    const r = await complete([
      { role: "system", content: "Translate restaurant menu items from Arabic to natural English menu wording. Keep dish names that are proper names transliterated (e.g. Kunafa, Machboos). Return ONLY a JSON array of {\"id\": number, \"nameEn\": string, \"descriptionEn\": string}." },
      { role: "user", content: JSON.stringify(input) },
    ], 60_000);
    for (const x of parseJsonArray(r?.text ?? "")) {
      const id = Number(x?.id);
      if (!group.some((g) => g.id === id) || typeof x?.nameEn !== "string") continue;
      await db.update(menuItemsTable).set({
        nameEn: x.nameEn.slice(0, 160),
        ...(typeof x.descriptionEn === "string" && x.descriptionEn.trim() ? { descriptionEn: x.descriptionEn.slice(0, 1200) } : {}),
      }).where(and(eq(menuItemsTable.id, id), eq(menuItemsTable.orgId, t.org.id)));
      done++;
    }
  }
  if (todoCats.length) {
    const r = await complete([
      { role: "system", content: "Translate these menu section names from Arabic to short English. Return ONLY a JSON array of {\"id\": number, \"nameEn\": string}." },
      { role: "user", content: JSON.stringify(todoCats.map((c) => ({ id: c.id, name: c.name }))) },
    ], 30_000);
    for (const x of parseJsonArray(r?.text ?? "")) {
      if (!todoCats.some((c) => c.id === Number(x?.id)) || typeof x?.nameEn !== "string") continue;
      await db.update(menuCategoriesTable).set({ nameEn: x.nameEn.slice(0, 120) }).where(and(eq(menuCategoriesTable.id, Number(x.id)), eq(menuCategoriesTable.orgId, t.org.id)));
    }
  }
  return { translated: done, error: done || !items.length ? null : "لم يرجع النموذج ترجمة صالحة — حاول مرة أخرى." };
}
