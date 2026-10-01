// ── Menu photos ───────────────────────────────────────────────────
// A phone photo of a dish is 4–8 MB; a menu of forty of them is unusable on
// 4G. Every upload is re-encoded here: WebP at three widths, and a tiny blurred
// copy inlined as a data URL so the card has a shape and a colour before the
// photo arrives. Re-encoding also means only image data is ever stored or
// served — whatever else the uploaded file carried is gone.

import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { putObject, MEDIA_URL_PREFIX } from "../storage";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const SIZES = { sm: 360, md: 760, lg: 1400 } as const;

export interface StoredImage { url: string; sm: string; md: string; blur: string; width: number; height: number }

export class ImageError extends Error {
  status = 400;
}

const urlFor = (name: string) => `${MEDIA_URL_PREFIX}${encodeURIComponent(name)}`;

export async function storeImage(buf: Buffer, prefix: "menu" | "logo" | "cover" | "offer" = "menu"): Promise<StoredImage> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new ImageError("الصورة أكبر من 15 ميجا");
  let meta: Metadata;
  try { meta = await sharp(buf, { failOn: "error" }).metadata(); }
  catch { throw new ImageError("الملف ليس صورة مدعومة (JPG أو PNG أو WebP أو HEIC)"); }
  if (!meta.width || !meta.height) throw new ImageError("تعذّرت قراءة الصورة");
  if (meta.width * meta.height > 60_000_000) throw new ImageError("أبعاد الصورة كبيرة جداً");

  const id = randomUUID();
  const base = sharp(buf).rotate(); // honour the phone's orientation, then drop EXIF
  const keepAlpha = prefix === "logo";
  const out: Record<string, string> = {};
  let lg: Buffer | null = null;
  for (const [k, w] of Object.entries(SIZES)) {
    const img = await base.clone()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: k === "lg" ? 80 : 76, alphaQuality: keepAlpha ? 90 : 0, effort: 4 })
      .toBuffer();
    const name = `menu-media/${prefix}/${id}-${k}.webp`;
    await putObject(name, img, "image/webp");
    out[k] = urlFor(name);
    if (k === "lg") lg = img;
  }
  const tiny = await base.clone().resize({ width: 16 }).blur(1.2).webp({ quality: 40 }).toBuffer();
  const done = await sharp(lg!).metadata();
  return {
    url: out.lg!, sm: out.sm!, md: out.md!,
    blur: `data:image/webp;base64,${tiny.toString("base64")}`,
    width: done.width ?? meta.width, height: done.height ?? meta.height,
  };
}
