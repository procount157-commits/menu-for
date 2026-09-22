/**
 * Media upload route — JSON / base64 payload.
 *
 * The Replit deployment proxy does not reliably forward multipart/form-data
 * POST requests to the API service.  Switching to a plain JSON upload
 * (base64-encoded file content) uses the same pathway as every other API
 * call and works in both development and production.
 *
 * Request body (application/json):
 *   { filename: string; mimetype: string; data: string }   ← base64, no prefix
 *
 * Response (200):
 *   { filename, path, url, size, mimetype, storage }
 */
import { Router, type RequestHandler } from "express";
import path from "path";
import { randomUUID } from "crypto";
import { objectStorageClient } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { requireAuth } from "../lib/auth";

const router = Router();

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
const OBJECT_PREFIX = "media-uploads";

const ALLOWED_EXT  = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|mkv|webm)$/i;
const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|x-msvideo|x-matroska|webm))$/;

// ── Upload (JSON / base64) ────────────────────────────────────────
const uploadHandler: RequestHandler = async (req, res): Promise<void> => {
  const { filename, mimetype, data } = req.body ?? {};

  if (!filename || !mimetype || !data) {
    res.status(400).json({ error: "filename، mimetype و data مطلوبة" });
    return;
  }

  if (!ALLOWED_EXT.test(filename) && !ALLOWED_MIME.test(mimetype)) {
    res.status(400).json({
      error: "نوع الملف غير مدعوم. الصور: jpg/png/gif/webp — الفيديو: mp4/mov/avi",
    });
    return;
  }

  // Decode base64 → Buffer
  let buffer: Buffer;
  try {
    // Strip data-URL prefix if the client included it  (data:image/png;base64,…)
    const raw = typeof data === "string" && data.includes(",") ? data.split(",")[1] : data;
    buffer = Buffer.from(raw, "base64");
  } catch {
    res.status(400).json({ error: "فشل فكّ ترميز الملف — تأكد من إرساله بصيغة base64" });
    return;
  }

  if (buffer.length > 64 * 1024 * 1024) {
    res.status(400).json({ error: "حجم الملف يتجاوز الحد المسموح (64 MB)" });
    return;
  }

  const ext = path.extname(filename).toLowerCase() || `.${mimetype.split("/")[1]}`;
  const objectName = `${OBJECT_PREFIX}/${randomUUID()}${ext}`;
  const serveUrl = `/api/media/file/${encodeURIComponent(objectName)}`;

  // ── Fallback: no bucket configured ──────────────────────────────
  if (!BUCKET_ID) {
    logger.warn("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — returning placeholder");
    res.json({ filename, path: serveUrl, url: serveUrl, size: buffer.length, mimetype, storage: "none" });
    return;
  }

  // ── Upload buffer to GCS ─────────────────────────────────────────
  try {
    logger.info({ objectName, size: buffer.length, mimetype }, "Uploading to Replit Object Storage");

    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const gcsFile = bucket.file(objectName);

    await gcsFile.save(buffer, {
      contentType: mimetype,
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

    logger.info({ objectName, size: buffer.length }, "Upload to Object Storage succeeded");

    res.json({ filename, path: serveUrl, url: serveUrl, size: buffer.length, mimetype, storage: "replit-gcs" });
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, objectName }, "GCS upload failed");
    res.status(500).json({ error: `فشل رفع الملف إلى التخزين: ${err?.message ?? "unknown error"}` });
  }
};

router.post("/upload", requireAuth, uploadHandler);

// ── Serve GCS object (proxy — keeps GCS URLs internal) ───────────
router.get("/file/:objectName", async (req, res): Promise<void> => {
  const objectName = decodeURIComponent(req.params.objectName);

  if (!BUCKET_ID) {
    res.status(503).json({ error: "Object Storage not configured" });
    return;
  }

  try {
    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }

    const [meta] = await file.getMetadata();
    res.setHeader("Content-Type", (meta.contentType as string) || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (meta.size) res.setHeader("Content-Length", String(meta.size));

    file.createReadStream().pipe(res);
  } catch (err: any) {
    logger.error({ err: err?.message, objectName }, "GCS serve error");
    if (!res.headersSent) res.status(500).json({ error: "خطأ في قراءة الملف" });
  }
});

export default router;
