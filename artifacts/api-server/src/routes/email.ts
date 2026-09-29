// ── Email marketing API ───────────────────────────────────────────
// Everything the section does, behind the session. The public half — the
// pixel, the click, the unsubscribe, the inbound hook — is routes/track.ts.

import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql, gte } from "drizzle-orm";
import {
  db, emailSettingsTable, emailContactsTable, emailListsTable, emailListMembersTable,
  emailTemplatesTable, emailCampaignsTable, emailSequencesTable, emailSequenceJobsTable,
  emailMessagesTable, emailEventsTable, emailInboundTable, type EmailStep,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { assertCanSend, assertCanAddContacts, planErrorToResponse } from "../lib/plans";
import { getSettings, overview, startCampaign, pauseCampaign, enrolInSequence, cancelSequencesFor, recordEvent, verdictFor, signals } from "../lib/email/service";
import { verifySettings, sendEmail, isConfigured, messageIdFor } from "../lib/email/provider";
import { checkDomain } from "../lib/email/dns";
import { cleanRows, detectColumns, checkMx, splitBy, type ImportRow } from "../lib/email/importer";
import { draftReply, sendReply, pollMailbox } from "../lib/email/inbound";
import { readWorkbook, parseTables, whatsappEntries } from "../lib/phone-import";
import { saveToNewGroup, validateInBackground } from "../lib/contact-save";
import { seedEmailDefaults, DEFAULT_SEQUENCE_NAME } from "../lib/email/seed";
import { newToken, renderEmail, personalize } from "../lib/email/tracking";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// ── Overview ──────────────────────────────────────────────────────
router.get("/overview", async (req, res) => res.json(await overview(req.session.userId!)));

router.get("/events", async (req, res) => {
  const userId = req.session.userId!;
  const since = req.query["since"] ? new Date(String(req.query["since"])) : new Date(Date.now() - 24 * 3_600_000);
  const rows = await db.select({ e: emailEventsTable, to: emailMessagesTable.toEmail, subject: emailMessagesTable.subject, campaignId: emailMessagesTable.campaignId })
    .from(emailEventsTable).leftJoin(emailMessagesTable, eq(emailMessagesTable.id, emailEventsTable.messageId))
    .where(and(eq(emailEventsTable.userId, userId), gte(emailEventsTable.createdAt, since)))
    .orderBy(desc(emailEventsTable.createdAt)).limit(200);
  res.json(rows.map((r) => ({ id: r.e.id, type: r.e.type, at: r.e.createdAt, to: r.to, subject: r.subject, url: r.e.url, campaignId: r.campaignId, meta: r.e.meta })));
});

// ── Settings ──────────────────────────────────────────────────────
const mask = (s: any) => s ? { ...s, smtpPass: s.smtpPass ? "••••••" : null, apiKey: s.apiKey ? "••••••" : null, imapPass: s.imapPass ? "••••••" : null } : null;

router.get("/settings", async (req, res) => {
  const s = await getSettings(req.session.userId!);
  res.json({ settings: mask(s), configured: isConfigured(s), trackingBase: (process.env["SITE_URL"] ?? "") || null, health: await verdictFor(req.session.userId!), signals: await signals(req.session.userId!) });
});

router.put("/settings", async (req, res) => {
  const userId = req.session.userId!;
  const b = req.body ?? {};
  const cur = await getSettings(userId);
  const keep = (v: unknown, old: string | null | undefined) => (v === "••••••" || v === undefined ? old ?? null : (v as string | null));
  const values = {
    userId,
    provider: ["smtp", "resend", "brevo"].includes(b.provider) ? b.provider : "smtp",
    smtpHost: b.smtpHost ?? null, smtpPort: Number(b.smtpPort) || 587, smtpSecure: !!b.smtpSecure,
    smtpUser: b.smtpUser ?? null, smtpPass: keep(b.smtpPass, cur?.smtpPass),
    apiKey: keep(b.apiKey, cur?.apiKey),
    fromName: b.fromName ?? null, fromEmail: b.fromEmail ?? null, replyTo: b.replyTo ?? null, signature: b.signature ?? null,
    hourlyCap: Math.min(500, Math.max(5, Number(b.hourlyCap) || 40)),
    dailyCap: Math.min(5000, Math.max(10, Number(b.dailyCap) || 300)),
    tracking: b.tracking !== false,
    imapHost: b.imapHost ?? null, imapPort: Number(b.imapPort) || 993, imapUser: b.imapUser ?? null, imapPass: keep(b.imapPass, cur?.imapPass),
    autoReply: !!b.autoReply,
    autoReplyDelayMin: Math.min(240, Math.max(2, Number(b.autoReplyDelayMin) || 12)),
    warmup: b.warmup !== false,
    inboundToken: cur?.inboundToken ?? randomBytes(18).toString("base64url"),
    updatedAt: new Date(),
  };
  const [row] = await db.insert(emailSettingsTable).values(values as any)
    .onConflictDoUpdate({ target: emailSettingsTable.userId, set: values as any }).returning();
  // The first configured account gets the ready-made sequence and templates.
  if (!cur) await seedEmailDefaults(userId).catch(() => {});
  res.json({ settings: mask(row), configured: isConfigured(row) });
});

router.post("/settings/test", async (req, res) => {
  const s = await getSettings(req.session.userId!);
  if (!s) return res.status(400).json({ ok: false, detail: "لا إعدادات" });
  res.json(await verifySettings(s));
});

router.post("/settings/test-send", async (req, res) => {
  const userId = req.session.userId!;
  const s = await getSettings(userId);
  if (!isConfigured(s)) return res.status(400).json({ error: "إعدادات البريد غير مكتملة" });
  const to = String(req.body?.to ?? s!.fromEmail);
  const token = newToken();
  const base = (process.env["SITE_URL"] ?? "").replace(/\/+$/, "");
  const r = renderEmail("<p>هذه رسالة اختبار من إعدادات البريد في FLOW HUB. إن وصلتك فالمُرسِل يعمل.</p><p><a href=\"https://example.com\">رابط للتجربة</a></p>", {},
    { base, token, secret: process.env["SESSION_SECRET"] ?? "wam", pixel: !!s!.tracking, links: !!s!.tracking },
    { base, token, fromName: s!.fromName ?? s!.fromEmail!, fromEmail: s!.fromEmail! });
  try {
    const out = await sendEmail(s!, { to, subject: "اختبار الإرسال — FLOW HUB", html: r.html, text: r.text, messageId: messageIdFor(token, s!.fromEmail!), unsubscribeUrl: null });
    res.json({ ok: true, providerId: out.providerId });
  } catch (err: any) { res.status(400).json({ ok: false, error: String(err?.message ?? err) }); }
});

router.get("/settings/dns", async (req, res) => {
  const s = await getSettings(req.session.userId!);
  if (!s?.fromEmail) return res.status(400).json({ error: "اضبط عنوان المُرسِل أولاً" });
  res.json(await checkDomain(s.fromEmail));
});

router.post("/settings/poll", async (req, res) => {
  const s = await getSettings(req.session.userId!);
  if (!s?.imapHost) return res.status(400).json({ error: "لا إعدادات IMAP" });
  res.json({ handled: await pollMailbox(s), lastError: (await getSettings(req.session.userId!))?.imapLastError ?? null });
});

// ── Contacts & lists ──────────────────────────────────────────────
router.get("/contacts", async (req, res) => {
  const userId = req.session.userId!;
  const q = String(req.query["q"] ?? "").trim().toLowerCase();
  const listId = Number(req.query["listId"]) || null;
  const status = String(req.query["status"] ?? "");
  const limit = Math.min(500, Number(req.query["limit"]) || 100);
  const offset = Number(req.query["offset"]) || 0;
  const conds = [eq(emailContactsTable.userId, userId)];
  if (q) conds.push(sql`(lower(${emailContactsTable.email}) like ${"%" + q + "%"} or lower(coalesce(${emailContactsTable.company},'')) like ${"%" + q + "%"} or lower(coalesce(${emailContactsTable.name},'')) like ${"%" + q + "%"})`);
  if (status) conds.push(eq(emailContactsTable.status, status));
  if (listId) conds.push(inArray(emailContactsTable.id, db.select({ id: emailListMembersTable.contactId }).from(emailListMembersTable).where(eq(emailListMembersTable.listId, listId))));
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(emailContactsTable).where(and(...conds)).orderBy(desc(emailContactsTable.createdAt)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)` }).from(emailContactsTable).where(and(...conds)),
  ]);
  res.json({ rows, total: Number(n) });
});

router.get("/lists", async (req, res) => {
  const userId = req.session.userId!;
  const lists = await db.select({
    l: emailListsTable,
    n: sql<number>`(select count(*) from email_list_members m where m.list_id = ${emailListsTable.id})`,
  }).from(emailListsTable).where(eq(emailListsTable.userId, userId)).orderBy(desc(emailListsTable.createdAt));
  res.json(lists.map((r) => ({ ...r.l, count: Number(r.n) })));
});

router.post("/lists", async (req, res) => {
  const [l] = await db.insert(emailListsTable).values({ userId: req.session.userId!, name: String(req.body?.name ?? "قائمة").slice(0, 160), description: req.body?.description ?? null }).returning();
  res.status(201).json(l);
});
router.delete("/lists/:id", async (req, res) => {
  await db.delete(emailListsTable).where(and(eq(emailListsTable.id, Number(req.params.id)), eq(emailListsTable.userId, req.session.userId!)));
  res.json({ ok: true });
});

/**
 * The import. A spreadsheet as it came (multipart `file`) or rows already
 * parsed by the browser (`rows`), and options: which list, whether to
 * split by industry or city into sub-lists, whether to check MX, and which
 * sequence to enrol everyone in. Reports exactly what was kept and why
 * the rest was not.
 */
router.post("/contacts/import", upload.single("file"), async (req, res) => {
  const userId = req.session.userId!;
  const body: any = req.body ?? {};
  let rawRows: Array<Record<string, unknown>> = [];
  let fileName = "";
  const country = String(body.country ?? "AE").toUpperCase().slice(0, 2);
  // Rows the shared reader found, for the WhatsApp half: every sheet, the
  // header row wherever it is, every number column, each row's country.
  let parsed: ReturnType<typeof parseTables> | null = null;
  if (req.file) {
    fileName = req.file.originalname;
    try { parsed = parseTables(readWorkbook(req.file.buffer), country); }
    catch { return res.status(400).json({ error: "تعذّر قراءة الملف — تأكد أنه Excel أو CSV" }); }
    // The email half reads the same rows, already mapped.
    rawRows = parsed.rows.map((r) => ({ email: r.email ?? "", name: r.person ?? "", company: r.company ?? "", phone: r.whatsapp?.e164 ?? "", industry: r.industry ?? "", city: r.city ?? "" }));
  } else if (Array.isArray(body.rows)) {
    rawRows = body.rows;
  } else if (typeof body.rows === "string") {
    try { rawRows = JSON.parse(body.rows); } catch { rawRows = []; }
  } else if (typeof body.text === "string") {
    // Pasted emails, one per line or comma-separated.
    rawRows = String(body.text).split(/[\n,;\s]+/).filter(Boolean).map((email) => ({ email }));
  }
  if (!rawRows.length) return res.status(400).json({ error: "لم أجد صفوفاً في الملف" });

  const columns = parsed
    ? { email: "email", name: "name", company: "company", phone: "phone", industry: "industry", city: "city" } as ReturnType<typeof detectColumns>
    : detectColumns(rawRows);
  const hasEmails = parsed ? parsed.rows.some((r) => r.email) : !!columns.email;
  const waOnly = parsed ? whatsappEntries(parsed.rows).entries.length : 0;
  if (!hasEmails && !waOnly) return res.status(400).json({ error: "لم أجد بريداً إلكترونياً ولا أرقام واتساب في الملف", columns });
  const report = cleanRows(rawRows, columns);

  // MX per domain, so a dead domain never costs a bounce.
  const doMx = body.mx !== "false" && body.mx !== false;
  let mxBad = 0;
  if (doMx && report.rows.length) {
    const mx = await checkMx(report.rows.map((r) => r.email.split("@")[1]!));
    for (const r of report.rows) (r as any).mxOk = mx.get(r.email.split("@")[1]!) ?? null;
    mxBad = report.rows.filter((r) => (r as any).mxOk === false).length;
  }

  // Upsert the contacts; existing ones keep their status.
  const source = (body.source ?? (fileName ? `ملف: ${fileName.slice(0, 50)}` : "استيراد")).slice(0, 60);
  let inserted = 0;
  const ids = new Map<string, number>();
  for (let i = 0; i < report.rows.length; i += 200) {
    const chunk = report.rows.slice(i, i + 200);
    const rows = await db.insert(emailContactsTable).values(chunk.map((r) => ({
      userId, email: r.email, name: r.name ?? null, company: r.company ?? null, phone: r.phone ?? null,
      industry: r.industry ?? null, city: r.city ?? null, source, mxOk: (r as any).mxOk ?? null,
    }))).onConflictDoNothing().returning({ id: emailContactsTable.id, email: emailContactsTable.email });
    inserted += rows.length;
    for (const r of rows) ids.set(r.email, r.id);
  }
  const existing = await db.select({ id: emailContactsTable.id, email: emailContactsTable.email, status: emailContactsTable.status }).from(emailContactsTable)
    .where(and(eq(emailContactsTable.userId, userId), inArray(emailContactsTable.email, report.rows.map((r) => r.email))));
  for (const r of existing) ids.set(r.email, r.id);
  const activeIds = existing.filter((r) => r.status === "active").map((r) => r.id);

  // The list, and the split.
  const listName = String(body.listName ?? (fileName ? fileName.replace(/\.[a-z]+$/i, "") : `استيراد ${new Date().toISOString().slice(0, 10)}`)).slice(0, 160);
  let listId = Number(body.listId) || null;
  if (!listId) {
    const [l] = await db.insert(emailListsTable).values({ userId, name: listName, description: `${report.kept} جهة اتصال — ${source}` }).returning();
    listId = l!.id;
  }
  const addAll = async (lid: number, rows: ImportRow[]) => {
    const members = rows.map((r) => ids.get(r.email)).filter((x): x is number => !!x);
    for (let i = 0; i < members.length; i += 500) {
      await db.insert(emailListMembersTable).values(members.slice(i, i + 500).map((contactId) => ({ listId: lid, contactId }))).onConflictDoNothing();
    }
  };
  await addAll(listId, report.rows);

  const splitField = body.splitBy === "industry" || body.splitBy === "city" ? body.splitBy : null;
  const subLists: Array<{ id: number; name: string; count: number }> = [];
  if (splitField) {
    for (const [k, rows] of splitBy(report.rows, splitField)) {
      const [l] = await db.insert(emailListsTable).values({ userId, name: `${listName} — ${k}`.slice(0, 160), description: `فرع من «${listName}» حسب ${splitField === "industry" ? "النشاط" : "المدينة"}` }).returning();
      await addAll(l!.id, rows);
      subLists.push({ id: l!.id, name: l!.name, count: rows.length });
    }
  }

  // Straight into the ladder, if asked.
  let enrolled = null as null | { enrolled: number; skipped: number };
  const sequenceId = Number(body.sequenceId) || null;
  if (sequenceId) enrolled = await enrolInSequence(userId, sequenceId, activeIds).catch((err) => { logger.warn({ err: String(err?.message ?? err) }, "enrol after import failed"); return null; });

  // The WhatsApp half. Every row with a WhatsApp number — including rows
  // with no email at all — goes into a number list named after this one,
  // under the company's name, so the same file feeds both channels.
  let whatsapp: null | { added: number; alreadyInList: number; duplicates: number; skippedLandline: number; groups: Array<{ id: number; name: string; count: number }>; verifying: boolean; error?: string } = null;
  if (parsed && body.saveWhatsapp !== "false" && body.saveWhatsapp !== false) {
    const wa = whatsappEntries(parsed.rows);
    if (wa.entries.length) {
      try {
        await assertCanAddContacts(userId, wa.entries.length);
        const saved = await saveToNewGroup(userId, `${listName} — واتساب`, `أرقام واتساب من ملف البريد${fileName ? `: ${fileName.slice(0, 80)}` : ""}`, wa.entries);
        const verifying = validateInBackground(userId, saved.groups.map((g) => g.id));
        whatsapp = { added: saved.added, alreadyInList: saved.existing, duplicates: wa.duplicates, skippedLandline: wa.skippedLandline, groups: saved.groups, verifying };
      } catch (err: any) {
        whatsapp = { added: 0, alreadyInList: 0, duplicates: wa.duplicates, skippedLandline: wa.skippedLandline, groups: [], verifying: false, error: String(err?.message ?? err) };
      }
    }
  }

  logger.info({ userId, file: fileName, total: report.total, kept: report.kept, inserted, mxBad, listId, sub: subLists.length, enrolled, whatsapp: whatsapp?.added ?? 0 }, "استيراد بريد");
  res.json({
    file: fileName || null, columns, total: report.total, kept: report.kept, inserted, alreadyKnown: report.kept - inserted,
    invalid: report.invalid, duplicates: report.duplicates, roleAddresses: report.roleAddresses, mxBad,
    list: { id: listId, name: listName }, subLists, enrolled, sample: report.sample,
    whatsapp, sheets: parsed?.sheets ?? null, byCountry: parsed?.byCountry ?? null,
  });
});

/** What the file looks like before committing to it. */
router.post("/contacts/preview", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ارفع ملفاً" });
  const country = String(req.body?.country ?? "AE").toUpperCase().slice(0, 2);
  let parsed: ReturnType<typeof parseTables>;
  try { parsed = parseTables(readWorkbook(req.file.buffer), country); }
  catch { return res.status(400).json({ error: "تعذّر قراءة الملف — تأكد أنه Excel أو CSV" }); }
  const rows = parsed.rows.map((r) => ({ email: r.email ?? "", name: r.person ?? "", company: r.company ?? "", phone: r.whatsapp?.e164 ?? "", industry: r.industry ?? "", city: r.city ?? "" }));
  const columns = { email: "email", name: "name", company: "company", phone: "phone", industry: "industry", city: "city" } as ReturnType<typeof detectColumns>;
  const report = cleanRows(rows, columns);
  const wa = whatsappEntries(parsed.rows);
  // The columns as found in the file, for the owner to check.
  const found = parsed.sheets[0]?.columns ?? {};
  const shown = { email: found["email"] ?? null, company: found["company"] ?? null, name: found["person"] ?? null, phone: found["phones"] ?? null, industry: found["industry"] ?? null, city: found["city"] ?? null };
  const byIndustry = [...splitBy(report.rows, "industry")].map(([k, v]) => ({ key: k, n: v.length })).sort((a, b) => b.n - a.n).slice(0, 20);
  const byCity = [...splitBy(report.rows, "city")].map(([k, v]) => ({ key: k, n: v.length })).sort((a, b) => b.n - a.n).slice(0, 20);
  res.json({ file: req.file.originalname, sheets: parsed.sheets, columns: shown, total: report.total, kept: report.kept, invalid: report.invalid, duplicates: report.duplicates, roleAddresses: report.roleAddresses, sample: report.sample, byIndustry, byCity,
    whatsapp: { numbers: wa.entries.length, landlineOnly: parsed.landlineOnly, duplicates: wa.duplicates, withoutEmail: parsed.rows.filter((r) => r.whatsapp && !r.email).length, byCountry: parsed.byCountry } });
});

router.patch("/contacts/:id", async (req, res) => {
  const userId = req.session.userId!;
  const set: Record<string, unknown> = {};
  for (const k of ["name", "company", "phone", "industry", "city", "status"] as const) if (req.body?.[k] !== undefined) set[k] = req.body[k];
  const [row] = await db.update(emailContactsTable).set(set).where(and(eq(emailContactsTable.id, Number(req.params.id)), eq(emailContactsTable.userId, userId))).returning();
  if (row && set["status"] && set["status"] !== "active") await cancelSequencesFor(userId, row.id, "أوقفه صاحب العمل");
  res.json(row ?? null);
});
router.delete("/contacts/:id", async (req, res) => {
  await db.delete(emailContactsTable).where(and(eq(emailContactsTable.id, Number(req.params.id)), eq(emailContactsTable.userId, req.session.userId!)));
  res.json({ ok: true });
});
router.get("/contacts/:id", async (req, res) => {
  const userId = req.session.userId!;
  const [c] = await db.select().from(emailContactsTable).where(and(eq(emailContactsTable.id, Number(req.params.id)), eq(emailContactsTable.userId, userId))).limit(1);
  if (!c) return res.status(404).json({ error: "غير موجود" });
  const [messages, inbound, jobs] = await Promise.all([
    db.select().from(emailMessagesTable).where(eq(emailMessagesTable.contactId, c.id)).orderBy(desc(emailMessagesTable.createdAt)).limit(30),
    db.select().from(emailInboundTable).where(eq(emailInboundTable.contactId, c.id)).orderBy(desc(emailInboundTable.receivedAt)).limit(30),
    db.select().from(emailSequenceJobsTable).where(eq(emailSequenceJobsTable.contactId, c.id)).orderBy(emailSequenceJobsTable.dueAt),
  ]);
  res.json({ contact: c, messages, inbound, jobs });
});

// ── Templates ─────────────────────────────────────────────────────
router.get("/templates", async (req, res) => res.json(await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.userId, req.session.userId!)).orderBy(desc(emailTemplatesTable.updatedAt))));
router.post("/templates", async (req, res) => {
  const { name, subject, html, category } = req.body ?? {};
  if (!name || !subject || !html) return res.status(400).json({ error: "الاسم والعنوان والمحتوى مطلوبة" });
  const [t] = await db.insert(emailTemplatesTable).values({ userId: req.session.userId!, name: String(name).slice(0, 160), subject: String(subject).slice(0, 300), html: String(html), category: category ?? null }).returning();
  res.status(201).json(t);
});
router.patch("/templates/:id", async (req, res) => {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ["name", "subject", "html", "category"] as const) if (req.body?.[k] !== undefined) set[k] = req.body[k];
  const [t] = await db.update(emailTemplatesTable).set(set).where(and(eq(emailTemplatesTable.id, Number(req.params.id)), eq(emailTemplatesTable.userId, req.session.userId!))).returning();
  res.json(t ?? null);
});
router.delete("/templates/:id", async (req, res) => {
  await db.delete(emailTemplatesTable).where(and(eq(emailTemplatesTable.id, Number(req.params.id)), eq(emailTemplatesTable.userId, req.session.userId!)));
  res.json({ ok: true });
});
router.post("/templates/seed", async (req, res) => res.json(await seedEmailDefaults(req.session.userId!, true)));
router.post("/preview", async (req, res) => {
  const s = await getSettings(req.session.userId!);
  const vars = { name: "خالد العلي", first_name: "خالد", company: "شركة النور للمقاولات", city: "دبي", industry: "مقاولات", sender: s?.fromName ?? "بروكاونت", sender_email: s?.fromEmail ?? "" };
  const r = renderEmail(String(req.body?.html ?? "") + (s?.signature ? `<div style="margin-top:20px">${s.signature}</div>` : ""), vars,
    { base: "", token: "preview", secret: "x", pixel: false, links: false },
    { base: "", token: "preview", fromName: s?.fromName ?? "بروكاونت", fromEmail: s?.fromEmail ?? "hello@example.com" });
  res.json({ subject: personalize(String(req.body?.subject ?? ""), vars), html: r.html, text: r.text });
});

// ── Campaigns ─────────────────────────────────────────────────────
router.get("/campaigns", async (req, res) => {
  const rows = await db.select({ c: emailCampaignsTable, list: emailListsTable.name }).from(emailCampaignsTable)
    .leftJoin(emailListsTable, eq(emailListsTable.id, emailCampaignsTable.listId))
    .where(eq(emailCampaignsTable.userId, req.session.userId!)).orderBy(desc(emailCampaignsTable.createdAt));
  res.json(rows.map((r) => ({ ...r.c, listName: r.list })));
});
router.post("/campaigns", async (req, res) => {
  const { name, listId, subject, html, scheduledAt, subjectB, abPct, abWaitHours } = req.body ?? {};
  if (!name || !subject || !html) return res.status(400).json({ error: "الاسم والعنوان والمحتوى مطلوبة" });
  const [c] = await db.insert(emailCampaignsTable).values({
    userId: req.session.userId!, name: String(name).slice(0, 160), listId: Number(listId) || null, subject: String(subject).slice(0, 300), html: String(html),
    status: scheduledAt ? "scheduled" : "draft", scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    subjectB: subjectB ? String(subjectB).slice(0, 300) : null,
    abPct: subjectB ? Math.min(50, Math.max(0, Number(abPct) || 20)) : 0,
    abWaitHours: Math.min(48, Math.max(1, Number(abWaitHours) || 4)),
  }).returning();
  res.status(201).json(c);
});
router.patch("/campaigns/:id", async (req, res) => {
  const set: Record<string, unknown> = {};
  for (const k of ["name", "subject", "html", "subjectB"] as const) if (req.body?.[k] !== undefined) set[k] = req.body[k];
  if (req.body?.abPct !== undefined) set["abPct"] = Math.min(50, Math.max(0, Number(req.body.abPct) || 0));
  if (req.body?.abWaitHours !== undefined) set["abWaitHours"] = Math.min(48, Math.max(1, Number(req.body.abWaitHours) || 4));
  if (req.body?.listId !== undefined) set["listId"] = Number(req.body.listId) || null;
  if (req.body?.scheduledAt !== undefined) { set["scheduledAt"] = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null; set["status"] = req.body.scheduledAt ? "scheduled" : "draft"; }
  const [c] = await db.update(emailCampaignsTable).set(set).where(and(eq(emailCampaignsTable.id, Number(req.params.id)), eq(emailCampaignsTable.userId, req.session.userId!), inArray(emailCampaignsTable.status, ["draft", "scheduled", "paused"]))).returning();
  res.json(c ?? null);
});
router.post("/campaigns/:id/start", async (req, res) => {
  try {
    await assertCanSend(req.session.userId!);
    res.json(await startCampaign(req.session.userId!, Number(req.params.id)));
  } catch (err: any) { if (planErrorToResponse(err, res)) return; res.status(400).json({ error: String(err?.message ?? err) }); }
});
router.post("/campaigns/:id/pause", async (req, res) => { await pauseCampaign(req.session.userId!, Number(req.params.id), "إيقاف يدوي"); res.json({ ok: true }); });
router.delete("/campaigns/:id", async (req, res) => {
  await db.delete(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, Number(req.params.id)), eq(emailCampaignsTable.userId, req.session.userId!)));
  res.json({ ok: true });
});
router.get("/campaigns/:id", async (req, res) => {
  const userId = req.session.userId!;
  const [c] = await db.select().from(emailCampaignsTable).where(and(eq(emailCampaignsTable.id, Number(req.params.id)), eq(emailCampaignsTable.userId, userId))).limit(1);
  if (!c) return res.status(404).json({ error: "غير موجود" });
  const [recipients, [funnel], byHour] = await Promise.all([
    db.select({ m: emailMessagesTable, name: emailContactsTable.name, company: emailContactsTable.company }).from(emailMessagesTable)
      .leftJoin(emailContactsTable, eq(emailContactsTable.id, emailMessagesTable.contactId))
      .where(eq(emailMessagesTable.campaignId, c.id)).orderBy(desc(emailMessagesTable.sentAt)).limit(2000),
    db.select({
      queued: sql<number>`count(*) filter (where ${emailMessagesTable.status} in ('queued','ab_hold'))`,
      held:   sql<number>`count(*) filter (where ${emailMessagesTable.status} = 'ab_hold')`,
      sent: sql<number>`count(*) filter (where ${emailMessagesTable.status} in ('sent','bounced'))`,
      opened: sql<number>`count(*) filter (where ${emailMessagesTable.openedAt} is not null)`,
      clicked: sql<number>`count(*) filter (where ${emailMessagesTable.clickedAt} is not null)`,
      replied: sql<number>`count(*) filter (where ${emailMessagesTable.repliedAt} is not null)`,
      bounced: sql<number>`count(*) filter (where ${emailMessagesTable.status} = 'bounced')`,
      failed: sql<number>`count(*) filter (where ${emailMessagesTable.status} = 'failed')`,
    }).from(emailMessagesTable).where(eq(emailMessagesTable.campaignId, c.id)),
    db.select({ h: sql<string>`to_char(date_trunc('hour', ${emailEventsTable.createdAt}), 'YYYY-MM-DD HH24:00')`, type: emailEventsTable.type, n: sql<number>`count(*)` })
      .from(emailEventsTable).innerJoin(emailMessagesTable, eq(emailMessagesTable.id, emailEventsTable.messageId))
      .where(eq(emailMessagesTable.campaignId, c.id)).groupBy(sql`1`, emailEventsTable.type).orderBy(sql`1`),
  ]);
  const variants = c.abPct > 0 ? await db.select({
    v: emailMessagesTable.variant,
    sent: sql<number>`count(*) filter (where ${emailMessagesTable.sentAt} is not null)`,
    opened: sql<number>`count(*) filter (where ${emailMessagesTable.openedAt} is not null)`,
    replied: sql<number>`count(*) filter (where ${emailMessagesTable.repliedAt} is not null)`,
  }).from(emailMessagesTable).where(and(eq(emailMessagesTable.campaignId, c.id), sql`${emailMessagesTable.variant} is not null`, sql`${emailMessagesTable.createdAt} <= coalesce(${c.abDecidedAt ?? null}::timestamptz, now())`))
    .groupBy(emailMessagesTable.variant) : [];
  res.json({ campaign: c, funnel: Object.fromEntries(Object.entries(funnel ?? {}).map(([k, v]) => [k, Number(v)])),
    ab: c.abPct > 0 ? { winner: c.abWinner, decidedAt: c.abDecidedAt, variants: variants.map((x) => ({ variant: x.v, sent: Number(x.sent), opened: Number(x.opened), replied: Number(x.replied) })) } : null,
    recipients: recipients.map((r) => ({ ...r.m, name: r.name, company: r.company })), timeline: byHour.map((r) => ({ hour: r.h, type: r.type, n: Number(r.n) })) });
});

// ── Sequences ─────────────────────────────────────────────────────
router.get("/sequences", async (req, res) => {
  const userId = req.session.userId!;
  const rows = await db.select({
    s: emailSequencesTable,
    pending: sql<number>`(select count(*) from email_sequence_jobs j where j.sequence_id = ${emailSequencesTable.id} and j.status = 'pending')`,
    sent: sql<number>`(select count(*) from email_sequence_jobs j where j.sequence_id = ${emailSequencesTable.id} and j.status = 'sent')`,
  }).from(emailSequencesTable).where(eq(emailSequencesTable.userId, userId)).orderBy(desc(emailSequencesTable.createdAt));
  res.json(rows.map((r) => ({ ...r.s, pending: Number(r.pending), sent: Number(r.sent), isDefault: r.s.name === DEFAULT_SEQUENCE_NAME })));
});
router.post("/sequences", async (req, res) => {
  const { name, steps, stopOnReply, stopOnOpen } = req.body ?? {};
  if (!name || !Array.isArray(steps) || !steps.length) return res.status(400).json({ error: "الاسم وخطوة واحدة على الأقل" });
  const clean: EmailStep[] = steps.map((s: any) => ({ afterHours: Math.max(0, Number(s.afterHours) || 0), subject: String(s.subject ?? "").slice(0, 300), html: String(s.html ?? "") })).filter((s: EmailStep) => s.subject && s.html);
  const [row] = await db.insert(emailSequencesTable).values({ userId: req.session.userId!, name: String(name).slice(0, 160), steps: clean, stopOnReply: stopOnReply !== false, stopOnOpen: !!stopOnOpen }).returning();
  res.status(201).json(row);
});
router.patch("/sequences/:id", async (req, res) => {
  const set: Record<string, unknown> = {};
  if (req.body?.name !== undefined) set["name"] = String(req.body.name).slice(0, 160);
  if (Array.isArray(req.body?.steps)) set["steps"] = req.body.steps.map((s: any) => ({ afterHours: Math.max(0, Number(s.afterHours) || 0), subject: String(s.subject ?? "").slice(0, 300), html: String(s.html ?? "") }));
  for (const k of ["stopOnReply", "stopOnOpen", "isActive"] as const) if (req.body?.[k] !== undefined) set[k] = !!req.body[k];
  const [row] = await db.update(emailSequencesTable).set(set).where(and(eq(emailSequencesTable.id, Number(req.params.id)), eq(emailSequencesTable.userId, req.session.userId!))).returning();
  res.json(row ?? null);
});
router.delete("/sequences/:id", async (req, res) => {
  await db.delete(emailSequencesTable).where(and(eq(emailSequencesTable.id, Number(req.params.id)), eq(emailSequencesTable.userId, req.session.userId!)));
  res.json({ ok: true });
});
router.post("/sequences/:id/enrol", async (req, res) => {
  const userId = req.session.userId!;
  try {
    await assertCanSend(userId);
    let ids: number[] = Array.isArray(req.body?.contactIds) ? req.body.contactIds.map(Number).filter(Boolean) : [];
    if (req.body?.listId) {
      const members = await db.select({ id: emailListMembersTable.contactId }).from(emailListMembersTable).where(eq(emailListMembersTable.listId, Number(req.body.listId)));
      ids = members.map((m) => m.id);
    }
    res.json(await enrolInSequence(userId, Number(req.params.id), ids));
  } catch (err: any) { if (planErrorToResponse(err, res)) return; res.status(400).json({ error: String(err?.message ?? err) }); }
});
router.get("/sequences/:id/jobs", async (req, res) => {
  const rows = await db.select({ j: emailSequenceJobsTable, email: emailContactsTable.email, company: emailContactsTable.company })
    .from(emailSequenceJobsTable).leftJoin(emailContactsTable, eq(emailContactsTable.id, emailSequenceJobsTable.contactId))
    .where(and(eq(emailSequenceJobsTable.sequenceId, Number(req.params.id)), eq(emailSequenceJobsTable.userId, req.session.userId!)))
    .orderBy(emailSequenceJobsTable.dueAt).limit(500);
  res.json(rows.map((r) => ({ ...r.j, email: r.email, company: r.company })));
});

// ── Inbound ───────────────────────────────────────────────────────
router.get("/inbound", async (req, res) => {
  const rows = await db.select({ i: emailInboundTable, company: emailContactsTable.company, ourSubject: emailMessagesTable.subject })
    .from(emailInboundTable).leftJoin(emailContactsTable, eq(emailContactsTable.id, emailInboundTable.contactId))
    .leftJoin(emailMessagesTable, eq(emailMessagesTable.id, emailInboundTable.messageId))
    .where(eq(emailInboundTable.userId, req.session.userId!)).orderBy(desc(emailInboundTable.receivedAt)).limit(200);
  res.json(rows.map((r) => ({ ...r.i, company: r.company, ourSubject: r.ourSubject })));
});
router.post("/inbound/:id/draft", async (req, res) => {
  const d = await draftReply(req.session.userId!, Number(req.params.id));
  if (!d) return res.status(400).json({ error: "تعذّرت المسودة — النموذج لم يستجب" });
  res.json(d);
});
router.post("/inbound/:id/send", async (req, res) => {
  try {
    await assertCanSend(req.session.userId!);
    res.json(await sendReply(req.session.userId!, Number(req.params.id), req.body?.subject, req.body?.body));
  } catch (err: any) { if (planErrorToResponse(err, res)) return; res.status(400).json({ error: String(err?.message ?? err) }); }
});
/** Stop an automatic send without ignoring the reply. */
router.post("/inbound/:id/hold", async (req, res) => {
  await db.update(emailInboundTable).set({ autoSendAt: null }).where(and(eq(emailInboundTable.id, Number(req.params.id)), eq(emailInboundTable.userId, req.session.userId!)));
  res.json({ ok: true });
});
router.post("/inbound/:id/ignore", async (req, res) => {
  await db.update(emailInboundTable).set({ state: "ignored", autoSendAt: null }).where(and(eq(emailInboundTable.id, Number(req.params.id)), eq(emailInboundTable.userId, req.session.userId!)));
  res.json({ ok: true });
});
/** Paste a reply that arrived elsewhere, so it is analysed like the rest. */
router.post("/inbound/manual", async (req, res) => {
  const { from, subject, text } = req.body ?? {};
  if (!from || !text) return res.status(400).json({ error: "المُرسِل والنص مطلوبان" });
  const { handleInbound } = await import("../lib/email/inbound");
  res.json(await handleInbound(req.session.userId!, { from: String(from), subject: subject ?? null, text: String(text) }));
});

// The counters, from events, for a message.
router.get("/messages/:id/events", async (req, res) => {
  const rows = await db.select().from(emailEventsTable).where(and(eq(emailEventsTable.messageId, Number(req.params.id)), eq(emailEventsTable.userId, req.session.userId!))).orderBy(emailEventsTable.createdAt);
  res.json(rows);
});
router.post("/messages/:id/event", async (req, res) => {
  // A bounce or complaint the owner saw in their mailbox and wants recorded.
  const type = String(req.body?.type ?? "");
  if (!["bounce", "complaint", "unsubscribe", "reply"].includes(type)) return res.status(400).json({ error: "نوع غير معروف" });
  await recordEvent(req.session.userId!, Number(req.params.id), type as any, { meta: { manual: true } });
  res.json({ ok: true });
});

export default router;
