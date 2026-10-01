// ── What a cart line costs ────────────────────────────────────────
// One function for the menu page (to show a total) and the server (to charge
// it). The server never takes a price from the browser: it re-runs this
// against the menu as stored, so an edited request can change what is
// ordered but never what it costs.

export interface OptionChoice { name: string; nameEn?: string; priceDelta: number }
export interface OptionGroup { name: string; nameEn?: string; required: boolean; min: number; max: number; choices: OptionChoice[] }

export interface PriceableItem {
  id: number;
  name: string;
  nameEn?: string | null;
  price: number;
  options: OptionGroup[];
}

/** What the customer picked: for each option group by name, the choices by name. */
export interface Selection { group: string; choices: string[] }

export interface CartLineInput {
  itemId: number;
  qty: number;
  selections?: Selection[];
  note?: string;
}

export interface PricedLine {
  itemId: number;
  name: string;
  nameEn?: string | null;
  qty: number;
  unitPrice: number;
  options: Array<{ group: string; choice: string; priceDelta: number }>;
  note?: string;
  lineTotal: number;
}

export const MAX_QTY = 99;
export const MAX_LINES = 60;

const money = (n: number) => Math.round(n * 100) / 100;

export function priceLine(item: PriceableItem, input: CartLineInput): { ok: true; line: PricedLine } | { ok: false; error: string } {
  const qty = Math.floor(Number(input.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, error: `الكمية غير صالحة (${item.name})` };

  const picked = new Map<string, string[]>();
  for (const s of input.selections ?? []) {
    if (!s || typeof s.group !== "string" || !Array.isArray(s.choices)) continue;
    picked.set(s.group, [...new Set(s.choices.filter((c) => typeof c === "string"))]);
  }
  for (const g of picked.keys()) {
    if (!item.options.some((o) => o.name === g)) return { ok: false, error: `خيار غير موجود: ${g}` };
  }

  const options: PricedLine["options"] = [];
  let unit = Number(item.price) || 0;
  for (const group of item.options) {
    const chosen = picked.get(group.name) ?? [];
    const min = Math.max(group.required ? 1 : 0, group.min || 0);
    const max = group.max > 0 ? group.max : group.choices.length;
    if (chosen.length < min) return { ok: false, error: `اختر ${group.name} (${item.name})` };
    if (chosen.length > max) return { ok: false, error: `الحد الأقصى ${max} في ${group.name}` };
    for (const name of chosen) {
      const c = group.choices.find((x) => x.name === name);
      if (!c) return { ok: false, error: `خيار غير موجود: ${name}` };
      const delta = Number(c.priceDelta) || 0;
      unit += delta;
      options.push({ group: group.name, choice: c.name, priceDelta: money(delta) });
    }
  }
  unit = money(Math.max(0, unit));
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : undefined;
  return {
    ok: true,
    line: {
      itemId: item.id, name: item.name, nameEn: item.nameEn ?? null, qty, unitPrice: unit, options,
      ...(note ? { note } : {}),
      lineTotal: money(unit * qty),
    },
  };
}

export function priceCart(
  items: Map<number, PriceableItem>,
  lines: CartLineInput[],
): { ok: true; lines: PricedLine[]; subtotal: number } | { ok: false; error: string } {
  if (!Array.isArray(lines) || lines.length === 0) return { ok: false, error: "السلة فارغة" };
  if (lines.length > MAX_LINES) return { ok: false, error: "السلة كبيرة جداً" };
  const out: PricedLine[] = [];
  for (const l of lines) {
    const item = items.get(Number(l?.itemId));
    if (!item) return { ok: false, error: "صنف غير متوفر حالياً — حدّث الصفحة" };
    const r = priceLine(item, l);
    if (!r.ok) return r;
    out.push(r.line);
  }
  return { ok: true, lines: out, subtotal: money(out.reduce((s, l) => s + l.lineTotal, 0)) };
}

export function formatMoney(n: number, currency = "AED", lang: "ar" | "en" = "ar"): string {
  const v = money(n);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const sym: Record<string, [string, string]> = { AED: ["د.إ", "AED"], SAR: ["ر.س", "SAR"], KWD: ["د.ك", "KWD"], QAR: ["ر.ق", "QAR"], BHD: ["د.ب", "BHD"], OMR: ["ر.ع", "OMR"], EGP: ["ج.م", "EGP"], USD: ["$", "USD"] };
  const [ar, en] = sym[currency] ?? [currency, currency];
  return lang === "ar" ? `${s} ${ar}` : `${en} ${s}`;
}
