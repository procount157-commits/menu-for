// Upload a list, the team does the rest: سلمى's recommendations from the
// numbers, the problems she names, طارق's approval card, and the charters
// that say who does which part.

export {};
const { recommend, problemsOf, MAX_RECOMMENDED } = await import("../email/pipeline");
const { cardText } = await import("../email/missions");
const { charterOf } = await import("../roles/charters");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${d}`); };

const recs = recommend([
  { sector: "أغذية", n: 900 },
  { sector: "عقارات", n: 800 },
  { sector: "حلويات", n: 600 },
  { sector: "كافيهات", n: 40 },
  { sector: "تجميل وصالونات", n: 30 },
  { sector: "مطاعم", n: 9 },
]);
check("at most three recommendations", recs.length === MAX_RECOMMENDED);
check("a sector with a written campaign outranks a bigger one without", recs[0]!.sector === "حلويات" && recs[1]!.sector === "أغذية", recs.map((r) => r.sector).join(" > "));
check("a firm that is not a shop is never recommended, however big", !recs.some((r) => r.sector === "عقارات"));
check("each carries its campaign and why", recs.every((r) => r.goal.length > 20 && r.why.length > 10 && r.angle.length > 3));
check("too small a sector gets no campaign", !recommend([{ sector: "مطاعم", n: 9 }]).length);
check("the sweets recommendation is the pre-order campaign", recs.find((r) => r.sector === "حلويات")!.goal.includes("الطلبات المسبقة"));
check("a shop sector without its own campaign gets the general introduction", recs.find((r) => r.sector === "أغذية")!.goal.includes("التعريف العامة"));

const base = { total: 1000, sendable: 900, deadDomain: 40, risk: { low: 800, medium: 100, high: 25 }, overlap: [{ listId: 7, name: "ALL", shared: 950 }], alreadyWritten: 600, role: 800, notShops: 120 };
const p = problemsOf(base);
check("dead domains are named", p.some((x) => x.includes("40") && x.includes("خادم")));
check("high-risk addresses are named", p.some((x) => x.includes("25") && x.includes("الخطورة")));
check("a near-copy of another list is named", p.some((x) => x.includes("ALL")));
check("already written to, half or more, is named", p.some((x) => x.includes("600")));
check("mostly role addresses is named", p.some((x) => x.includes("info@")));
check("firms that are not shops are named", p.some((x) => x.includes("120") && x.includes("ليست محلات")));
check("an empty list says so", problemsOf({ ...base, sendable: 0, deadDomain: 0, risk: { low: 0, medium: 0, high: 0 }, overlap: [], alreadyWritten: 0, role: 0, notShops: 0 }).some((x) => x.includes("لا يوجد")));

// طارق's card: what the owner approves, in numbers.
const draft = { subjects: ["زحمة الباب؟", "دور رقمي لمحلكم"], html: "", followups: [{ audience: "warm" as const, afterHours: 72, subject: "x", html: "" }, { audience: "cold" as const, afterHours: 96, subject: "y", html: "" }], why: "الكافيهات تعيش زحمة الصبح" };
const c = cardText(450, 100, draft, []);
check("the card says how many, over how many days at today's allowance", c.days === 5 && c.line.includes("450") && c.line.includes("5 أيام") && c.line.includes("100 يومياً"));
check("...the subjects and their test, the follow-ups and why", c.text.includes("زحمة الباب؟") && c.text.includes("دور رقمي لمحلكم") && c.line.includes("2 متابعات حتى اليوم 4") && c.text.includes("الكافيهات"));
check("...and ماجد's notes, or that he found nothing", c.text.includes("سليمة") && cardText(10, 50, draft, ["لا زر دعوة"]).text.includes("لا زر دعوة"));
check("a small audience goes in a day", cardText(30, 100, draft, []).days === 1 && cardText(30, 100, draft, []).line.includes("يوم واحد"));

check("سلمى's charter: analyse on upload, recommend, brief نورة", charterOf("email_strategist")!.when.includes("فور رفع") && charterOf("email_strategist")!.delivers.includes("موجز"));
check("طارق's charter: the approval card, then launch", charterOf("email_creator")!.delivers.includes("بطاقة موافقة") && charterOf("email_creator")!.mission.includes("بلا أن يختار"));

// سلمى's reading runs against the real schema (no model): an empty list of the test account.
{
  const { analyzeList } = await import("../email/pipeline");
  const { db, emailListsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [l] = await db.insert(emailListsTable).values({ userId: 1, name: `pipeline-test-${Date.now()}` }).returning();
  try {
    const a = await analyzeList(1, l!.id);
    check("an empty list is read without error, and says it is empty", a.total === 0 && a.sendable === 0 && a.notShops === 0 && a.problems.some((x) => x.includes("لا يوجد")) && !a.recommendations.length);
  } catch (e: any) {
    check("an empty list is read without error, and says it is empty", false, String(e?.cause?.message ?? e?.message ?? e).slice(0, 120));
  } finally {
    await db.delete(emailListsTable).where(eq(emailListsTable.id, l!.id));
  }
}

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
