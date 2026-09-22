import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.resolve(process.cwd(), "settings.json");

export interface SiteSettings {
  whatsappNumber: string;
  salesWhatsapp: string;
  supportWhatsapp: string;
  heroTitleAr: string;
  heroTitleEn: string;
  heroSubAr: string;
  heroSubEn: string;
}

const DEFAULTS: SiteSettings = {
  whatsappNumber:  "971588951186",
  salesWhatsapp:   "971588951186",
  supportWhatsapp: "971588951186",
  heroTitleAr: "أرسل آلاف الرسائل عبر واتساب باحترافية",
  heroTitleEn: "Scale Your WhatsApp Marketing Effortlessly",
  heroSubAr: "وقم بإدارة حملاتك وقوائمك وعملائك من منصة واحدة.",
  heroSubEn: "Manage campaigns, contacts and customer engagement from one platform.",
};

export function readSettings(): SiteSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(updates: Partial<SiteSettings>): SiteSettings {
  const current = readSettings();
  const updated = { ...current, ...updates };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf8");
  return updated;
}
