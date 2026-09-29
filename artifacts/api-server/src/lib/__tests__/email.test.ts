import { personalize, firstName, rewriteLinks, pixelTag, htmlToText, renderEmail, signUrl } from "../email/tracking";
import { normalizeEmail, isRoleAddress, detectColumns, cleanRows, splitBy } from "../email/importer";
import { assessEmail, sendGapMs } from "../email/health";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(58)} ${d}`); };

// ── Merge fields ─────────────────────────────────────────────────
check("{{name}} is filled", personalize("أهلاً {{name}}", { name: "أحمد" }) === "أهلاً أحمد");
check("a fallback covers a missing field", personalize("أهلاً {{name|صاحب الشركة}}", { name: "" }) === "أهلاً صاحب الشركة");
check("an unknown field vanishes rather than leaking braces", personalize("x {{foo}} y", {}) === "x  y");
check("first name skips a title", firstName("المهندس خالد العلي") === "خالد" && firstName("Mr. Ahmed Ali") === "Ahmed");

// ── Tracking ─────────────────────────────────────────────────────
const t = { base: "https://site.example", token: "tok123", secret: "s", pixel: true, links: true };
const html = '<p><a href="https://procount.example/aml">AML</a> <a href="mailto:x@y.z">mail</a> <a href="#top">top</a></p>';
const rw = rewriteLinks(html, t);
check("http links go through the redirect", rw.includes("https://site.example/t/e/tok123/c?u=https%3A%2F%2Fprocount.example%2Faml&s="));
check("...signed", rw.includes(`&s=${signUrl("s", "tok123", "https://procount.example/aml")}`));
check("mailto and anchors are left alone", rw.includes('href="mailto:x@y.z"') && rw.includes('href="#top"'));
check("no base, no rewriting", rewriteLinks(html, { ...t, base: "" }) === html);
check("the pixel points at the token", pixelTag(t).includes("/t/e/tok123.gif"));
check("no pixel without a base", pixelTag({ ...t, base: "" }) === "");
const r = renderEmail("<p>مرحباً {{name}}</p>", { name: "سارة" }, t, { base: t.base, token: t.token, fromName: "بروكاونت", fromEmail: "hello@procount.example" });
check("the render carries the footer and the pixel", r.html.includes("إلغاء الاشتراك") && r.html.includes("tok123.gif") && r.html.includes("سارة"));
check("...and a text part", r.text.startsWith("مرحباً سارة"));
check("html to text keeps links readable", htmlToText('<p>see <a href="https://a.b">this</a><br>now</p>') === "see this (https://a.b)\nnow");

// ── The importer ─────────────────────────────────────────────────
check("emails normalise", normalizeEmail(" Info@Company.AE ") === "info@company.ae");
check("junk is rejected", normalizeEmail("not an email") === null && normalizeEmail("a@b") === null);
check("role addresses are recognised", isRoleAddress("info@x.ae") && !isRoleAddress("khalid@x.ae"));

const rows = [
  { "اسم الشركة": "شركة النور للمقاولات", "الإيميل": "info@alnoor.ae", "الجوال": "0501234567", "النشاط": "مقاولات", "الإمارة": "دبي" },
  { "اسم الشركة": "مطعم البيت", "الإيميل": "Owner@albait.ae", "الجوال": "", "النشاط": "مطاعم", "الإمارة": "الشارقة" },
  { "اسم الشركة": "مكرر", "الإيميل": "info@alnoor.ae", "الجوال": "", "النشاط": "مقاولات", "الإمارة": "دبي" },
  { "اسم الشركة": "بلا بريد", "الإيميل": "—", "الجوال": "", "النشاط": "", "الإمارة": "" },
];
const cols = detectColumns(rows);
check("Arabic headers are detected", cols.email === "الإيميل" && cols.company === "اسم الشركة" && cols.phone === "الجوال" && cols.industry === "النشاط" && cols.city === "الإمارة", JSON.stringify(cols));
const rep = cleanRows(rows);
check("two kept, one duplicate, one invalid", rep.kept === 2 && rep.duplicates === 1 && rep.invalid === 1, `${rep.kept}/${rep.duplicates}/${rep.invalid}`);
check("the phone is normalised", rep.rows[0]?.phone === "0501234567" || rep.rows[0]?.phone === "501234567");
check("role addresses are counted, not dropped", rep.roleAddresses === 1);
const headerless = [{ A: "x", B: "someone@firm.ae", C: "Firm LLC" }, { A: "y", B: "other@co.ae", C: "Co LLC" }];
const c2 = detectColumns(headerless);
check("without headers the values decide", c2.email === "B" && c2.company === "C", JSON.stringify(c2));
const groups = splitBy(rep.rows, "industry");
check("split by industry", groups.get("مقاولات")?.length === 1 && groups.get("مطاعم")?.length === 1);

// ── Deliverability ───────────────────────────────────────────────
const fine = { sent24h: 200, bounced24h: 2, complaints24h: 0, unsubscribed24h: 1, opened24h: 60, replied24h: 3, senderAgeDays: 30 };
check("a healthy sender is left alone", assessEmail(fine).level === "ok" && assessEmail(fine).throttle === 1);
check("3% bounces slows", assessEmail({ ...fine, bounced24h: 7 }).throttle >= 2);
check("6% bounces stops", assessEmail({ ...fine, bounced24h: 13 }).holdMinutes > 0);
check("one complaint in 200 is a stop — that is 0.5%", assessEmail({ ...fine, complaints24h: 1 }).holdMinutes > 0);
check("two in 1,500 is a warning", assessEmail({ ...fine, sent24h: 1500, complaints24h: 2 }).level === "warning");
check("a new sender is throttled but not stopped", assessEmail({ ...fine, senderAgeDays: 2 }).throttle > 1 && assessEmail({ ...fine, senderAgeDays: 2 }).holdMinutes === 0);
check("under the sample nothing fires", assessEmail({ ...fine, sent24h: 10, bounced24h: 5 }).level === "ok");
check("no opens and no replies at volume is a warning", assessEmail({ ...fine, opened24h: 3, replied24h: 0 }).level === "warning");
const gaps = Array.from({ length: 50 }, (_, i) => sendGapMs(40, 1, () => i / 50));
check("40 an hour means about 90 s apart, jittered", Math.min(...gaps) >= 60_000 && Math.max(...gaps) <= 120_000, `${Math.min(...gaps)}–${Math.max(...gaps)}`);
check("the gap never drops under 20 s however high the cap", sendGapMs(100000, 1, () => 0) >= 14_000);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
