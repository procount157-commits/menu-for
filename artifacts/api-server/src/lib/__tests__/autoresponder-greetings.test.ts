// The business greetings a shop sets once and forgets — what the platform's
// seller meets when it writes to a restaurant or a salon — are machines; the
// people who wrote back are not.

export {};
const { detectAutoresponder } = await import("../autoresponder");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${d}`); };

const machines = [
  "‏شكرا لك على تواصلك مع  مطعم بيت الشامي من فضلك أخبرنا كيف يمكننا خدمتك",
  "Thank you for reaching Al Reem Sweets! Please let us know how we can help you.",
  "🌿 مرحبًا بكم في *صالون لمسة*.  يسرّنا خدمتكم، ونلتزم بتقديم أفضل خدمات التجميل",
  "‏شكرا لك على تواصلك مع كافيه الفارس . من فضلك أخبرنا كيف يمكننا خدمتك.",
  "Thank you for choosing Burger Point, our menu is in the catalogue",
  "📢 Please subscribe to our channel to be notified once we have any offer",
  "Thank you for your message how can we help you 😊",
];
for (const m of machines) {
  const v = detectAutoresponder(m, { isFirstFromThem: true });
  check(`machine: ${m.slice(0, 44)}`, v.isAuto, String(v.confidence));
}
const people = [
  "مهتم",
  "كم سعر الكنافة؟",
  "ابي احجز طاولة لاربعة الساعة ٩",
  "Hi, do you deliver to Al Barsha?",
  "هلا، وش الفرق بينكم وبين طلبات؟",
  "شكرا، بس احنا عندنا منيو QR",
  "مرحبا بكم، عندكم فطور الجمعة؟",
];
for (const m of people) {
  const v = detectAutoresponder(m, { isFirstFromThem: true });
  check(`person: ${m.slice(0, 44)}`, !v.isAuto, String(v.confidence));
}

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
