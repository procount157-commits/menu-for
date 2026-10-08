// The restructure, without a model: every employee has a charter and it
// reaches their instructions; the host's playbook is in the prompt; what we
// sent the customer is readable; a template blank never goes; and the
// follow-up ladder chases only those who spoke and went quiet.

export {};
const { charterOf, charterBlock, ALL_CHARTER_ROLES } = await import("../roles/charters");
const { personaPreamble } = await import("../agent-router");
const { buildSystemPrompt, SALES_JOB } = await import("../knowledge");
const { readableTemplate, outreachPreamble } = await import("../outreach-context");
const { checkReply, blocksSend } = await import("../reply-check");
const { dueRung, overlap, LADDER, MAX_RUNGS, RUNG_ANGLE } = await import("../smart-followup");
const { sellerPrompt, DEFAULT_SETTINGS, SELLER_ROLE } = await import("../sales/brief");
const { EMAIL_TEAM } = await import("../email/team");
const { db, botEmployeesTable } = await import("@workspace/db");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${d}`); };

// ── Charters ─────────────────────────────────────────────────────
const roles = (await db.selectDistinct({ role: botEmployeesTable.role }).from(botEmployeesTable)).map((r) => r.role);
const without = roles.filter((r) => !charterOf(r));
check("every employee in the database has a charter", without.length === 0, without.join(", "));
check("...and every email role and the platform's seller", [...EMAIL_TEAM, SELLER_ROLE].every((r) => ALL_CHARTER_ROLES.includes(r)));
const b = charterBlock("sales");
check("a charter says mission, delivery, measure and handoff", ["مهمتك", "ما تسلّمه", "تُقاس بـ", "تسلّم إلى"].every((k) => b.includes(k)));
check("the host's charter is about orders, turns and bookings — not selling the platform", /طلب أو دور أو حجز/.test(charterOf("sales")!.mission) && !/منيو فور يو/.test(charterOf("sales")!.mission));
check("the email team sells Menu For You to shops", /منيو فور يو/.test(charterOf("email_strategist")!.department) && /محل/.test(charterOf("email_replies")!.mission));
const pre = personaPreamble({ agent: { name: "هال", title: "المضيّف", persona: "دافئ", role: "sales" } as any, handoff: null } as any);
check("the charter sits right after who they are", pre.indexOf("دورك في الفريق") > pre.indexOf("شخصيتك") && pre.includes("مهمتك"));
const seller = sellerPrompt({ s: DEFAULT_SETTINGS, product: "x", links: {}, mode: "opener" });
check("the platform's seller reads her charter", seller.includes("دورك في الفريق") && seller.indexOf("دورك في الفريق") > seller.indexOf("شخصيتك"));

// ── The host's playbook and the campaign context ─────────────────
const sys = buildSystemPrompt(null, [], [], "اسمك هال.", undefined, undefined, 1, "═══ ما أرسلناه له ═══");
check("the host's prompt carries the playbook's situations", sys.includes("ردّ على رسالة أو عرض أرسلناه") && sys.includes("«مهتم» أو ضغط زر الاهتمام") && sys.includes("يسأل عن السعر"));
check("a special request goes to a person from the shop", SALES_JOB.some((l) => l.includes("طلب خاص")) && SALES_JOB.some((l) => l.includes("شخصاً من المحل")));
const t = readableTemplate("{تحية} {الاسم|يا هلا} 👋\n{عرض الويكند|عرض نهاية الأسبوع}: كنافة بالقشطة\n{cta}\n\n━━━━━━━━━━\n🔕 لإيقاف الرسائل أرسل: 0", "أبو خالد");
check("a campaign reads as the customer saw it", t.startsWith("أبو خالد 👋") && t.includes("عرض الويكند: كنافة") && !t.includes("{") && !t.includes("أرسل: 0"), JSON.stringify(t));
check("...and with no name, the template's own fallback", readableTemplate("هلا {الاسم|يا الغالي}!").startsWith("هلا يا الغالي"));
const o = outreachPreamble({ campaign: "عرض الويكند", text: "x", buttons: ["أبي أطلب"], daysAgo: 2, read: true }, "أبو خالد");
check("the employee is told what we sent and to continue it", o.includes("قبل 2 أيام") && o.includes("أكمل موضوعها") && o.includes("أبو خالد") && o.includes("أبي أطلب"));

// ── The blank that must never go to a customer ───────────────────
const q = checkReply("هلا [الاسم]! الحجز من هنا: {رابط الحجز}", { customer: "ابي احجز" });
check("«[الاسم]» is caught and stops the send", q.issues.some((i) => i.code === "placeholder") && blocksSend(q));
check("an ordinary reply is not blocked", !blocksSend(checkReply("هلا! الكنافة موجودة اليوم، تبيها سفري ولا توصيل؟", { customer: "عندكم كنافة" })));

// ── The follow-up ladder ────────────────────────────────────────
const H = 3_600_000, now = Date.UTC(2026, 9, 7, 9);
const at = (h: number) => new Date(now - h * H);
const spoke = [{ fromMe: true, text: "عرض الويكند", at: at(100) }, { fromMe: false, text: "كم سعر الصينية؟", at: at(50) }, { fromMe: true, text: "٩٠ درهم…", at: at(49) }];
check("someone who spoke and went quiet a day+ is due rung 1", dueRung(spoke, [], false, now)?.rung === 0);
check("...not before the day is up", dueRung(spoke.map((x, i) => i === 2 ? { ...x, at: at(10) } : x), [], false, now) === null);
check("a warm customer is followed after 4 hours", dueRung(spoke.map((x, i) => i === 2 ? { ...x, at: at(5) } : x), [], true, now)?.rung === 0);
check("a campaign recipient who never replied is never chased", dueRung([{ fromMe: true, text: "campaign", at: at(500) }], [], false, now) === null);
check("an unanswered message from them is the reply path's, not ours", dueRung([...spoke, { fromMe: false, text: "؟", at: at(30) }], [], false, now) === null);
const older = [{ fromMe: false, text: "كم السعر؟", at: at(150) }, { fromMe: true, text: "٩٠ درهم…", at: at(149) }];
check("rung 2 waits three days after rung 1", dueRung(older, [at(40)], false, now) === null && dueRung(older, [at(100)], false, now)?.rung === 1);
check("four at most, then silence", dueRung(spoke, [at(48), at(47), at(46), at(45)], false, now) === null && MAX_RUNGS === 4 && LADDER.cold.length === 4);
check("their reply resets the ladder", dueRung([...spoke, { fromMe: false, text: "تمام", at: at(30) }, { fromMe: true, text: "…", at: at(29) }], [at(45), at(44)], false, now)?.rung === 0);
check("four rungs, four different angles", new Set(RUNG_ANGLE).size === 4);
check("a near-copy of an earlier follow-up is recognised", overlap("تحب أرسل لك رابط الحجز لطاولة الجمعة؟", "تحب أرسل لك رابط الحجز لطاولة الجمعة") > 0.6 && overlap("رابط الحجز", "الكنافة بالقشطة رجعت") < 0.3);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
