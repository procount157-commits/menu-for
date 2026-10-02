// ── The shop's look ───────────────────────────────────────────────
// Four templates and a brand colour; everything else is derived, including
// whether text on the brand colour is dark or light.

import { TEMPLATES, type Template } from "@workspace/menu-shared";

function hexToRgb(h: string): [number, number, number] {
  const m = h.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [34, 197, 94];
}

function luminance([r, g, b]: [number, number, number]) {
  const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function applyTheme(theme: { template?: Template; brand?: string } | null | undefined) {
  const tpl = TEMPLATES[(theme?.template ?? "noir") as Template] ?? TEMPLATES.noir;
  const brand = /^#[0-9a-f]{6}$/i.test(theme?.brand ?? "") ? theme!.brand! : "#22c55e";
  const rgb = hexToRgb(brand);
  // Flow Hub sets black on its green; the same rule gives white on a deep brand colour.
  const ink = luminance(rgb) > 0.36 ? "#04150b" : "#ffffff";
  const root = document.documentElement.style;
  const mix = (a: string, b: string, p: number) => `color-mix(in srgb, ${a} ${p}%, ${b})`;
  root.setProperty("--bg", tpl.bg);
  root.setProperty("--surface", tpl.surface);
  root.setProperty("--surface-2", mix(tpl.surface, tpl.dark ? "#ffffff" : "#000000", tpl.dark ? 94 : 96));
  root.setProperty("--text", tpl.text);
  root.setProperty("--muted", tpl.muted);
  root.setProperty("--line", tpl.dark ? "rgba(255,255,255,0.08)" : "rgba(20,15,10,0.08)");
  root.setProperty("--brand", brand);
  root.setProperty("--brand-ink", ink);
  root.setProperty("--brand-soft", `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${tpl.dark ? 0.16 : 0.12})`);
  root.setProperty("--shadow", tpl.dark ? "0 10px 40px -12px rgba(0,0,0,.6)" : "0 12px 36px -14px rgba(60,40,20,.22)");
  root.setProperty("color-scheme", tpl.dark ? "dark" : "light");
  const meta = document.querySelector('meta[name="theme-color"]') ?? Object.assign(document.createElement("meta"), { name: "theme-color" });
  meta.setAttribute("content", tpl.bg);
  if (!meta.parentNode) document.head.appendChild(meta);
  return { dark: tpl.dark };
}
