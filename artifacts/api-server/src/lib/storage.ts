// ── Media storage ─────────────────────────────────────────────────
// Campaign media used to go straight to Google Cloud Storage through the
// Replit sidecar on 127.0.0.1:1106. Off Replit that endpoint does not exist,
// so uploads failed — and worse, the upload route answered 200 with a URL it
// had not stored anything behind, so the failure only surfaced later as every
// recipient failing with "ملف الوسائط مفقود أو غير صالح".
//
// Storage is now behind this interface with local disk as the default, which
// works on localhost and on any single-server deployment. GCS is still used
// when DEFAULT_OBJECT_STORAGE_BUCKET_ID is set, so a Replit deployment keeps
// working unchanged.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";

export const MEDIA_URL_PREFIX = "/api/media/file/";

const BUCKET_ID = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] ?? "";

/** Where local objects live. Created on demand. */
export const MEDIA_ROOT = path.resolve(
  process.env["MEDIA_DIR"] ?? path.join(process.cwd(), "uploads"),
);

export type Driver = "gcs" | "local";
export function storageDriver(): Driver {
  return BUCKET_ID ? "gcs" : "local";
}

const EXT_CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif",  ".webp": "image/webp",
  ".mp4": "video/mp4",  ".mov": "video/quicktime", ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska", ".webm": "video/webm",
};

export function contentTypeForName(objectName: string): string {
  return EXT_CONTENT_TYPE[path.extname(objectName).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolve an object name to a path inside MEDIA_ROOT.
 *
 * Object names reach this from URL parameters, so a name like
 * `../../etc/passwd` must not escape the media directory.
 */
function localPath(objectName: string): string {
  const full = path.resolve(MEDIA_ROOT, objectName);
  const root = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep;
  if (full !== MEDIA_ROOT && !full.startsWith(root)) {
    throw new Error(`MEDIA_CONFIG_ERR: اسم ملف غير صالح (${objectName})`);
  }
  return full;
}

/** Strip the serving prefix from a stored mediaUrl, or null if it is not one. */
export function objectNameFromUrl(mediaUrl: string): string | null {
  if (!mediaUrl.startsWith(MEDIA_URL_PREFIX)) return null;
  return decodeURIComponent(mediaUrl.slice(MEDIA_URL_PREFIX.length));
}

export async function putObject(objectName: string, buffer: Buffer, contentType: string): Promise<void> {
  if (storageDriver() === "gcs") {
    await objectStorageClient.bucket(BUCKET_ID).file(objectName).save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });
    return;
  }
  const dest = localPath(objectName);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, buffer);
  logger.info({ objectName, size: buffer.length, root: MEDIA_ROOT }, "media stored on local disk");
}

export async function objectExists(objectName: string): Promise<boolean> {
  try {
    if (storageDriver() === "gcs") {
      const [exists] = await objectStorageClient.bucket(BUCKET_ID).file(objectName).exists();
      return exists;
    }
    await fsp.access(localPath(objectName), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function statObject(objectName: string): Promise<{ contentType: string; size: number } | null> {
  try {
    if (storageDriver() === "gcs") {
      const file = objectStorageClient.bucket(BUCKET_ID).file(objectName);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [meta] = await file.getMetadata();
      return {
        contentType: (meta.contentType as string) || contentTypeForName(objectName),
        size: Number(meta.size ?? 0),
      };
    }
    const st = await fsp.stat(localPath(objectName));
    return { contentType: contentTypeForName(objectName), size: st.size };
  } catch {
    return null;
  }
}

export function createObjectReadStream(objectName: string): Readable {
  if (storageDriver() === "gcs") {
    return objectStorageClient.bucket(BUCKET_ID).file(objectName).createReadStream();
  }
  return fs.createReadStream(localPath(objectName));
}

/**
 * Read an object whole.
 *
 * Buffered rather than streamed on purpose: a GCS stream can stall without
 * ever emitting 'error', which left Baileys waiting and turned a missing file
 * into an opaque send timeout. A bounded read either resolves or throws.
 */
export async function getObjectBuffer(objectName: string, timeoutMs = 20_000): Promise<Buffer> {
  if (storageDriver() === "gcs") {
    const file = objectStorageClient.bucket(BUCKET_ID).file(objectName);
    const [buffer] = await Promise.race([
      file.download() as Promise<[Buffer]>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MEDIA_NOT_FOUND: انتهت مهلة تحميل الملف — ${objectName}`)), timeoutMs),
      ),
    ]);
    return buffer;
  }
  try {
    return await fsp.readFile(localPath(objectName));
  } catch {
    throw new Error(`MEDIA_NOT_FOUND: ملف الوسائط غير موجود (${objectName})`);
  }
}
