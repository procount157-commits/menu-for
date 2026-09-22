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
import {
  putObject, statObject, createObjectReadStream,
  storageDriver, MEDIA_URL_PREFIX, MEDIA_ROOT,
} from "../lib/storage";
import { logger } from "../lib/logger";
import { requireAuth } from "../lib/auth";

const router = Router();

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
  const serveUrl = `${MEDIA_URL_PREFIX}${encodeURIComponent(objectName)}`;

  // There is deliberately no "storage not configured" success path here. This
  // route used to answer 200 with a URL nothing was stored behind whenever the
  // bucket was unset, so the upload looked fine and the campaign only failed
  // later, once per recipient. A failure to store is now a failure to upload.
  try {
    await putObject(objectName, buffer, mimetype);
    logger.info({ objectName, size: buffer.length, driver: storageDriver() }, "media upload stored");
    res.json({
      filename, path: serveUrl, url: serveUrl,
      size: buffer.length, mimetype, storage: storageDriver(),
    });
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack, objectName, driver: storageDriver(), root: MEDIA_ROOT }, "media upload failed");
    res.status(500).json({ error: `فشل حفظ الملف: ${err?.message ?? "خطأ غير معروف"}` });
  }
};

router.post("/upload", requireAuth, uploadHandler);

// ── Serve GCS object (proxy — keeps GCS URLs internal) ───────────
router.get("/file/:objectName", async (req, res): Promise<void> => {
  const objectName = decodeURIComponent(req.params.objectName);

  try {
    const meta = await statObject(objectName);
    if (!meta) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }

    res.setHeader("Content-Type", meta.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (meta.size) res.setHeader("Content-Length", String(meta.size));

    const stream = createObjectReadStream(objectName);
    stream.on("error", (err) => {
      logger.error({ err, objectName }, "media stream error");
      if (!res.headersSent) res.status(500).json({ error: "خطأ في قراءة الملف" });
      else res.destroy();
    });
    stream.pipe(res);
  } catch (err: any) {
    logger.error({ err: err?.message, objectName }, "media serve error");
    if (!res.headersSent) res.status(500).json({ error: "خطأ في قراءة الملف" });
  }
});

export default router;
