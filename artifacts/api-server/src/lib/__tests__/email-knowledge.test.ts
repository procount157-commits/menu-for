// The email section's knowledge library, against the real tables for user 1
// and without calling a model: files read into text (Excel, HTML, PDF Arabic
// put back in reading order), long text cut at paragraph ends, the passages
// that bear on a question found — a sector's own and the general ones, not
// another sector's — and a document deleted with the facts drawn from it.

import * as XLSX from "xlsx";
import { and, eq, like } from "drizzle-orm";
import { db, agentMemoryTable, emailKnowledgeDocsTable } from "@workspace/db";
import { extractText, fixPdfArabic, chunks, tidy, addDoc, passages, library } from "../email/knowledge-docs";
import { rememberKnowledge, EMAIL_ROLE } from "../email/agent";

const USER = 1;
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(60)} ${d}`); };

async function clean() {
  await db.delete(emailKnowledgeDocsTable).where(and(eq(emailKnowledgeDocsTable.userId, USER), like(emailKnowledgeDocsTable.title, "اختبار-معرفة%")));
  await db.delete(agentMemoryTable).where(and(eq(agentMemoryTable.userId, USER), eq(agentMemoryTable.role, EMAIL_ROLE), like(agentMemoryTable.content, "اختبار-معرفة%")));
}
await clean();

// ── Reading ──────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["الباقة", "السعر"], ["أساسية", "4500 درهم"]]), "الأسعار");
const xl = await extractText(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer, "prices.xlsx");
check("an Excel sheet is read with its name", xl.includes("الأسعار") && xl.includes("4500 درهم"), JSON.stringify(xl.slice(0, 60)));
const html = await extractText(Buffer.from("<html><style>p{}</style><p>نحن <b>بروكاونت</b></p><p>AML</p></html>"), "about.html");
check("HTML loses its tags and styles", !html.includes("<") && !html.includes("p{}") && html.includes("بروكاونت"));
let refused = "";
try { await extractText(Buffer.from("x"), "old.doc"); } catch (e: any) { refused = e.message; }
check("an old .doc is refused with what to do", refused.includes(".docx"), refused);
try { refused = ""; await extractText(Buffer.from("x"), "a.exe"); } catch (e: any) { refused = e.message; }
check("an unknown format is refused", refused.includes("غير مدعومة"));

// A PDF line as stored: joined shapes, words in drawing order.
check("PDF Arabic back in reading order", fixPdfArabic(".ﺔﯾرﺎﻘﻌﻟا ﺔطﺎﺳﻮﻟا تﺎﻛﺮﺸﻟ AML لﺎﺜﺘﻣا").normalize("NFC").startsWith("ل"), fixPdfArabic(".ﺔﯾرﺎﻘﻌﻟا ﺔطﺎﺳﻮﻟا تﺎﻛﺮﺸﻟ AML لﺎﺜﺘﻣا"));
const real = fixPdfArabic(".اﻟﻌﻘﺎرﯾﺔ اﻟﻮﺳﺎﻃﺔ ﻟﺸﺮﻛﺎت AML اﻣﺘﺜﺎل ﺑﺎﻗﺔ ﺗﻘﺪم ﻟﻠﻤﺤﺎﺳﺒﺔ ﺑﺮوﻛﺎوﻧﺖ");
check("...shapes become plain letters, the full stop goes last", real === "بروكاونت للمحاسبة تقدم باقة امتثال AML لشركات الوساطة العقارية.", real);
check("...an English run keeps its order", fixPdfArabic("ﺷﺮﻛﺔ Pro Count ﻣﻊ").includes("Pro Count"), fixPdfArabic("ﺷﺮﻛﺔ Pro Count ﻣﻊ"));
check("a line without shapes is left alone", fixPdfArabic("Hello world") === "Hello world");

// ── Cutting ──────────────────────────────────────────────────────
const long = Array.from({ length: 60 }, (_, i) => `فقرة ${i} ` + "كلمة ".repeat(60)).join("\n\n");
const parts = chunks(long, 2000);
check("long text is cut into pieces under the size", parts.length > 1 && parts.every((p) => p.length <= 2000), `${parts.length}`);
check("...at paragraph ends, nothing lost", parts.join("").replace(/\s/g, "").length === long.replace(/\s/g, "").length);
check("tidy keeps paragraphs, drops runs of spaces", tidy("أ   ب\n\n\n\nج") === "أ ب\n\nج");

// ── Finding ──────────────────────────────────────────────────────
const general = await addDoc(USER, { title: "اختبار-معرفة الخدمات", category: "services", content: "باقة الامتثال الأساسية سعرها 4500 درهم سنوياً وتشمل التسجيل في goAML.\n\nنعمل من دبي وأبوظبي." }, { learn: false });
const realty = await addDoc(USER, { title: "اختبار-معرفة العقارات", category: "sector", sector: "عقارات", content: "شركات الوساطة العقارية ملزمة بالإبلاغ عن الصفقات النقدية فوق 55 ألف درهم." }, { learn: false });
await addDoc(USER, { title: "اختبار-معرفة الذهب", category: "sector", sector: "ذهب ومجوهرات", content: "تجار الذهب ملزمون بالإبلاغ عن الصفقات النقدية فوق 55 ألف درهم." }, { learn: false });
const p1 = await passages(USER, "كم سعر باقة الامتثال", { limit: 3 });
check("the price passage is found", p1[0]?.docId === general.id && p1[0]!.text.includes("4500"), p1.map((p) => p.title).join(" | "));
const p2 = await passages(USER, "الإبلاغ عن الصفقات النقدية", { sectors: ["عقارات"] });
check("a sector's question finds its own document", p2.some((p) => p.docId === realty.id));
check("...and not another sector's", !p2.some((p) => p.title.includes("الذهب")), p2.map((p) => p.title).join(" | "));
check("a question about nothing finds nothing", (await passages(USER, "طقس الغد في لندن")).length === 0);

// ── Deleting ─────────────────────────────────────────────────────
await rememberKnowledge(USER, "اختبار-معرفة الباقة الأساسية 4500 درهم", null, general.id);
await rememberKnowledge(USER, "اختبار-معرفة معلومة يدوية", null);
const lib = await library(USER);
check("the library lists the documents without their text", lib.docs.some((d: any) => d.id === general.id) && !("content" in lib.docs[0]!));
check("...and the facts with no document apart", lib.loose.some((f) => f.content === "اختبار-معرفة معلومة يدوية") && !lib.loose.some((f) => f.docId));
await db.delete(emailKnowledgeDocsTable).where(eq(emailKnowledgeDocsTable.id, general.id));
const left = await db.select().from(agentMemoryTable).where(and(eq(agentMemoryTable.userId, USER), like(agentMemoryTable.content, "اختبار-معرفة%")));
check("deleting a document takes its facts", !left.some((f) => f.content.includes("4500")));
check("...and leaves the facts typed by hand", left.some((f) => f.content === "اختبار-معرفة معلومة يدوية"));

await clean();
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
