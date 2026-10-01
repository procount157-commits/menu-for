// ── Message templates ─────────────────────────────────────────────
// The owner edits these in their own words; variables are written the way
// Flow Hub campaigns already write {الاسم}, with English aliases.

export const TEMPLATE_VARS: Array<{ key: string; en: string; label: string }> = [
  { key: "الاسم",  en: "name",     label: "اسم الزبون" },
  { key: "الرقم",  en: "number",   label: "رقم التذكرة أو الطلب" },
  { key: "قدامك",  en: "ahead",    label: "كم قدامه في الصف" },
  { key: "الوقت",  en: "eta",      label: "الوقت التقريبي أو الموعد" },
  { key: "الفرع",  en: "branch",   label: "اسم الفرع" },
  { key: "المحل",  en: "shop",     label: "اسم المحل" },
  { key: "الرابط", en: "link",     label: "رابط التذكرة أو الطلب" },
  { key: "التفاصيل", en: "details", label: "تفاصيل الطلب أو الحجز" },
  { key: "الاجمالي", en: "total",  label: "إجمالي الطلب" },
];

export type TemplateVars = Partial<Record<"name" | "number" | "ahead" | "eta" | "branch" | "shop" | "link" | "details" | "total", string | number>>;

export function renderTemplate(text: string, vars: TemplateVars): string {
  let out = String(text ?? "");
  for (const v of TEMPLATE_VARS) {
    const val = vars[v.en as keyof TemplateVars];
    const s = val === undefined || val === null ? "" : String(val);
    out = out.split(`{${v.key}}`).join(s).split(`{${v.en}}`).join(s);
  }
  // A variable with nothing in it should not leave "عزيزي ،" behind.
  return out.replace(/[ \t]+([،,.!؟?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
