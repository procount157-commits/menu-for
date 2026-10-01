// ── The cart ──────────────────────────────────────────────────────
// Kept on the phone per shop, so a customer who closes the tab to check
// WhatsApp comes back to the same order. Prices here are for display; the
// server prices the order again from the menu.

import { useSyncExternalStore } from "react";
import { priceLine, type PublicItem, type Selection } from "@workspace/menu-shared";

export interface CartLine { key: string; itemId: number; qty: number; selections: Selection[]; note?: string }

let slug = "";
let lines: CartLine[] = [];
const listeners = new Set<() => void>();
const emit = () => { save(); listeners.forEach((f) => f()); };

function save() { try { localStorage.setItem(`mfy:${slug}:cart`, JSON.stringify(lines)); } catch { /* ignore */ } }

export function initCart(s: string) {
  slug = s;
  try { lines = JSON.parse(localStorage.getItem(`mfy:${slug}:cart`) ?? "[]"); } catch { lines = []; }
  if (!Array.isArray(lines)) lines = [];
}

const keyOf = (itemId: number, selections: Selection[], note?: string) =>
  `${itemId}|${selections.map((s) => `${s.group}:${[...s.choices].sort().join("+")}`).sort().join(";")}|${note ?? ""}`;

export function addLine(itemId: number, qty: number, selections: Selection[], note?: string) {
  const key = keyOf(itemId, selections, note);
  const ex = lines.find((l) => l.key === key);
  lines = ex ? lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, l.qty + qty) } : l)) : [...lines, { key, itemId, qty, selections, note }];
  emit();
}

export function setQty(key: string, qty: number) {
  lines = qty <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l));
  emit();
}

export function clearCart() { lines = []; emit(); }

export function useCart(): CartLine[] {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => lines, () => lines);
}

export interface PricedCart { rows: Array<{ line: CartLine; item: PublicItem; unit: number; total: number }>; subtotal: number; count: number; stale: boolean }

export function priced(cart: CartLine[], items: PublicItem[]): PricedCart {
  const byId = new Map(items.map((i) => [i.id, i]));
  let subtotal = 0, count = 0, stale = false;
  const rows: PricedCart["rows"] = [];
  for (const l of cart) {
    const item = byId.get(l.itemId);
    if (!item || !item.available) { stale = true; continue; }
    const r = priceLine({ id: item.id, name: item.name, price: item.price, options: item.options }, { itemId: l.itemId, qty: l.qty, selections: l.selections });
    if (!r.ok) { stale = true; continue; }
    rows.push({ line: l, item, unit: r.line.unitPrice, total: r.line.lineTotal });
    subtotal += r.line.lineTotal; count += l.qty;
  }
  return { rows, subtotal: Math.round(subtotal * 100) / 100, count, stale };
}
