// Buttons in WhatsApp messages and the stop period: real native-flow buttons,
// the clean text fallback, the «إيقاف الرسائل» button on marketing, reading a
// press, and the database trigger that sets how long a stop lasts.

import { eq, sql } from "drizzle-orm";
import { db, usersTable, platformSettingsTable, unsubscribedPhonesTable } from "@workspace/db";
import {
  marketingSend, nativeButtons, interactiveContent, textWithButtons, buttonReplyText, withStopButton, cleanMessaging, parseButtons,
  sweepExpiredStops, saveMessaging, STOP_ID, STOP_TEXT, DEFAULT_MESSAGING,
} from "../wa-buttons";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d: unknown = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(66)} ${typeof d === "string" ? d : JSON.stringify(d)}`); };

// ── Adding the stop button ───────────────────────────────────────
let m = marketingSend("text", null);
check("a text campaign becomes a message with the stop button", m.messageType === "button" && parseButtons(m.buttons)[0]!.type === "stop");
m = marketingSend("image", null);
check("an image campaign keeps its image and gets the button", m.messageType === "image_button" && parseButtons(m.buttons).length === 1);
m = marketingSend("button", JSON.stringify([{ type: "url", text: "احجز", url: "https://x.test" }, { type: "stop", text: "إيقاف" }]));
check("a campaign's own buttons stay, and the stop is not added twice", parseButtons(m.buttons).length === 2);
check("a carousel is left as it is", marketingSend("carousel", null).buttons === null);
check("the stop button has its own id", withStopButton([]).at(-1)!.id === STOP_ID);

// ── Real buttons ─────────────────────────────────────────────────
const nb = nativeButtons([
  { type: "url", text: "افتح المنيو", url: "https://m.test/a" }, { type: "url", text: "سيء", url: "javascript:x" },
  { type: "call", text: "اتصل", phone: "+971 50 123 4567" }, { type: "reply", text: "أبي أشوف" }, { type: "stop", text: STOP_TEXT },
]);
check("a link is an open-link button, a bad link is dropped", nb[0]!.name === "cta_url" && JSON.parse(nb[0]!.buttonParamsJson).url === "https://m.test/a" && nb.length === 4);
check("a number is a call button with its digits", nb[1]!.name === "cta_call" && JSON.parse(nb[1]!.buttonParamsJson).phone_number === "+971501234567");
check("a reply and the stop are quick replies; the stop carries its id", nb[2]!.name === "quick_reply" && JSON.parse(nb[3]!.buttonParamsJson).id === STOP_ID);
check("at most ten buttons, labels cut to 25", nativeButtons(Array.from({ length: 14 }, (_, i) => ({ type: "reply" as const, text: `زر رقم ${i} بنص طويل جداً جداً` }))).every((b, _, a) => a.length === 10 && JSON.parse(b.buttonParamsJson).display_text.length <= 25));
const ic = interactiveContent("نص", withStopButton([]), "منيو فور يو") as any;
check("the interactive message carries body, footer and native-flow buttons", ic.interactiveMessage.body.text === "نص" && ic.interactiveMessage.footer.text === "منيو فور يو" && ic.interactiveMessage.nativeFlowMessage.buttons.length === 1);

// ── The text fallback ────────────────────────────────────────────
const tw = textWithButtons("عرض اليوم", [{ type: "url", text: "اطلب", url: "https://m.test" }, { type: "reply", text: "مهتم" }, { type: "stop", text: STOP_TEXT }]);
check("without real buttons: clean lines, no drawn pills", tw.includes("🔗 اطلب: https://m.test") && tw.includes("«مهتم»") && tw.includes(`أرسل: ${STOP_TEXT}`) && !tw.includes("╭"), tw);
check("no buttons, no lines", textWithButtons("نص", []) === "نص");

// ── Reading a press ──────────────────────────────────────────────
check("pressing the stop button reads as «إيقاف الرسائل»", buttonReplyText({ interactiveResponseMessage: { body: { text: "إيقاف الرسائل" }, nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: STOP_ID }) } } }) === STOP_TEXT);
check("…even if its label was changed", buttonReplyText({ interactiveResponseMessage: { body: { text: "Stop" }, nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: STOP_ID }) } } }) === STOP_TEXT);
check("a quick reply reads as its label", buttonReplyText({ interactiveResponseMessage: { body: { text: "أبي أشوف" }, nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: "mfy:reply:أبي أشوف" }) } } }) === "أبي أشوف");
check("an old-style button reply with the stop id too", buttonReplyText({ buttonsResponseMessage: { selectedButtonId: STOP_ID, selectedDisplayText: "x" } }) === STOP_TEXT);
check("a plain message is not a press", buttonReplyText({ conversation: "هلا" }) === "");

// ── Settings ─────────────────────────────────────────────────────
check("the stop lasts 150 days by default, with the button on and real buttons off", DEFAULT_MESSAGING.stopDays === 150 && DEFAULT_MESSAGING.stopButton && !DEFAULT_MESSAGING.interactive);
check("the stop period is bounded; 0 means for good", cleanMessaging({ stopDays: -5 }, DEFAULT_MESSAGING).stopDays === 0 && cleanMessaging({ stopDays: 99999 }, DEFAULT_MESSAGING).stopDays === 3650);

// ── The trigger and the sweep ────────────────────────────────────
const [orig] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "messaging"));
const [u] = await db.insert(usersTable).values({ phone: `99966${Math.floor(Math.random() * 1e7)}`, passwordHash: "!", displayName: "stop test" }).returning();
try {
  await saveMessaging({ stopDays: 150 });
  await db.insert(unsubscribedPhonesTable).values({ userId: u!.id, phone: "971500000201", reason: "test" });
  let [r] = await db.select().from(unsubscribedPhonesTable).where(eq(unsubscribedPhonesTable.phone, "971500000201"));
  const days = (r!.until!.getTime() - Date.now()) / 86_400_000;
  check("a stop lasts the platform's period (150 days)", days > 149.9 && days < 150.1, days);
  await saveMessaging({ stopDays: 0 });
  await db.insert(unsubscribedPhonesTable).values({ userId: u!.id, phone: "971500000202", reason: "test" });
  [r] = await db.select().from(unsubscribedPhonesTable).where(eq(unsubscribedPhonesTable.phone, "971500000202"));
  check("with 0 days a stop is for good", r!.until === null);
  await db.insert(unsubscribedPhonesTable).values({ userId: u!.id, phone: "971500000203", reason: "test", until: new Date(Date.now() - 60_000) });
  await sweepExpiredStops();
  const left = await db.select().from(unsubscribedPhonesTable).where(eq(unsubscribedPhonesTable.userId, u!.id));
  check("when the period is over the number is free again; the others stay", left.length === 2 && !left.some((x) => x.phone === "971500000203"), left.map((x) => x.phone));
} finally {
  await db.delete(usersTable).where(eq(usersTable.id, u!.id));
  if (orig) await db.update(platformSettingsTable).set({ value: orig.value }).where(eq(platformSettingsTable.key, "messaging"));
  else await db.execute(sql`DELETE FROM platform_settings WHERE key = 'messaging'`);
}

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
