import {
  assessSession, isRejection, isHandshakeRejection,
  MAX_REJECTS_BEFORE_REPAIR, FLAP_LIMIT, FLAP_WINDOW_MS,
} from "../session-breaker";

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(56)} ${d}`); };
const NOW = 1_700_000_000_000;
const base = { failuresSinceStable: 0, recentConnects: [] as number[], now: NOW };

console.log("— أي أسباب تعني رفض الاعتمادات —");
check("401 رفض (تسجيل خروج)", isRejection(401));
check("403 رفض", isRejection(403));
// 405 is WhatsApp refusing the client version in the handshake. Fifty
// credential wipes on this account were all "آخرها 405", and the credentials
// were fine every time — the version was stale. It must never count.
check("405 ليس رفضاً للاعتمادات — بل للإصدار", !isRejection(405));
check("405 يُقرأ رفض مصافحة", isHandshakeRejection(405));
check("401 ليس رفض مصافحة", !isHandshakeRejection(401));
// These are ordinary drops; clearing credentials over them would force a scan
// for what a retry fixes on its own.
check("408 ليس رفضاً (انتهاء مهلة)", !isRejection(408));
check("428 ليس رفضاً (إغلاق نظيف)", !isRejection(428));
check("515 ليس رفضاً (إعادة تشغيل)", !isRejection(515));
check("بلا سبب ليس رفضاً", !isRejection(undefined));

console.log("\n— عتبة الرفض —");
check("تحت العتبة لا يُصلح", !assessSession({ ...base, reason: 401, failuresSinceStable: MAX_REJECTS_BEFORE_REPAIR - 1 }).repair);
const hit = assessSession({ ...base, reason: 401, failuresSinceStable: MAX_REJECTS_BEFORE_REPAIR });
check("عند العتبة يُصلح", hit.repair && hit.cause === "credentials_rejected", hit.reason?.slice(0, 44));

console.log("\n— التذبذب: يتصل ولا يثبت —");
const flaps = Array.from({ length: FLAP_LIMIT }, (_, i) => NOW - i * 60_000);
const fl = assessSession({ ...base, reason: 408, recentConnects: flaps });
check("اتصالات متكررة بلا ثبات تُهدّئ لا تُصلح", !fl.repair && fl.cooldown && fl.cause === "flapping", fl.reason?.slice(0, 44));
check("أقل من الحد لا يفعل شيئاً", !assessSession({ ...base, reason: 408, recentConnects: flaps.slice(1) }).cooldown);
// Old connections must age out, or a healthy number that reconnected a few
// times over days eventually trips it for no reason.
const old = Array.from({ length: FLAP_LIMIT + 4 }, (_, i) => NOW - FLAP_WINDOW_MS - i * 60_000);
check("الاتصالات القديمة تسقط من النافذة", !assessSession({ ...base, reason: 408, recentConnects: old }).cooldown);

console.log("\n— حدود لا تُتجاوز —");
// Without this the app would wipe the pairing of a user who just pressed
// "disconnect", and hand them a QR they never asked for.
const manual = assessSession({ ...base, reason: 401, failuresSinceStable: 99, recentConnects: flaps, manualLogout: true });
check("الخروج اليدوي لا يُصلَح ولا يُهدَّأ فوقه", !manual.repair && !manual.cooldown);
check("جلسة سليمة لا تُمسّ", !assessSession({ ...base, reason: 428 }).repair);
// 408 alone is a dropped connection, not a rejected pairing: it must never
// count toward the credential threshold however often it happens.
check("408 المتكرر وحده لا يمسح الاعتمادات",
  !assessSession({ ...base, reason: 408, failuresSinceStable: 0, recentConnects: [NOW] }).repair);
// The failure that actually happened: five 405s in a row. The old breaker
// wiped the pairing here; the counter is simply never advanced for 405 now,
// so failuresSinceStable stays 0 and nothing fires.
check("خمسة 405 متتالية لا تمسح شيئاً",
  !assessSession({ ...base, reason: 405, failuresSinceStable: 0 }).repair);

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
