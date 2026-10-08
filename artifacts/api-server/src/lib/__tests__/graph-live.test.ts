// The living graph: everyone sits at their desk, every receipt reads as a
// few words, and the map is drawn from the ledger without error.

export {};
const { DESKS, deskOf, doing, liveGraph } = await import("../graph/live");
const { receipt } = await import("../graph/receipts");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${d}`); };
const U = 1;

check("the manager is the centre", deskOf("chief") === "center");
check("the host, customer service and follow-up are one desk", ["sales", "support", "followup"].every((r) => deskOf(r) === "host"));
check("the email team is a desk, led by سلمى's role", deskOf("email") === "email" && deskOf("email_guard") === "email" && DESKS.find((d) => d.key === "email")!.lead === "email_strategist");
check("operations and data are one desk", ["ops", "monitor", "intake", "collector"].every((r) => deskOf(r) === "ops"));
check("the platform's seller has her own desk", deskOf("shop_sales") === "platform");
check("the code sits in the system desk", ["router", "gate", "sender", "campaign", "unattributed"].every((r) => deskOf(r) === "system"));
check("a role matching nothing is «other»", deskOf("ig_writer") === "other");
check("a receipt reads as a few words", doing("reply", "ok") === "ردّ على عميل" && doing("sales.opener", "ok").includes("محل") && doing("llm.call", "blocked") === "موقوف" && doing("send.email", "failed") === "تعثّر");
check("an unknown message between employees still reads", doing("edge.directive", "ok") === "راسل زميلاً");

receipt({ userId: U, node: "router", action: "decide", status: "blocked", why: "اختبار الجراف" });
await new Promise((r) => setTimeout(r, 300));
const g = await liveGraph(U);
check("the map is drawn from the ledger", Array.isArray(g.nodes) && Array.isArray(g.edges) && g.events.length > 0 && g.stats.runs > 0);
check("a code node with receipts is on the map", g.nodes.some((n) => n.id === "router" && n.kind === "system"));
check("every desk on the map has someone in it", g.desks.every((d) => d.members.length > 0));
check("every line joins two people on the map", g.edges.every((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to)));

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
