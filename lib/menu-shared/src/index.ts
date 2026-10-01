export * from "./pricing";
export * from "./eta";
export * from "./time";
export * from "./slots";
export * from "./codes";
export * from "./vocab";
export * from "./slug";
export * from "./template";
export * from "./types";

/** wa.me link with a prefilled message. `phone` is digits in international form. */
export function waMeLink(phone: string | null | undefined, text: string): string | null {
  const p = String(phone ?? "").replace(/\D/g, "");
  if (p.length < 8) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
