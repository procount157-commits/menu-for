// الكاروسيل: إعلانات بجانب بعض. دوالّ صِرفة.
export {};
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
const { cardBody, carouselButtons, carouselReady, nativeButtons, STOP_ID } = await import("../wa-buttons");
let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(56)} ${d}`); };
const cards = [
  { title: "وجبة العائلة", description: "٤ أشخاص بـ ٩٩ درهم", imageUrl: "/u/a.jpg", buttonText: "اطلب الآن", buttonUrl: "menu.example/order" },
  { title: "الحلويات", imageUrl: "/u/b.jpg" },
];
const cb = carouselButtons(cards);
check("every card has the same number of buttons", cb.every((b) => b.length === cb[0]!.length));
check("stop is last on every card, with its id", cb.every((b) => b[b.length - 1]!.id === STOP_ID));
check("a link gets https", cb[0]![0]!.url === "https://menu.example/order");
check("the link renders as an open-link button", nativeButtons(cb[0]!)[0]!.name === "cta_url");
check("a card without a link replies instead", cb[1]![0]!.type === "reply");
check("stop off: cards still have a button", carouselButtons([{ title: "a", imageUrl: "x" }, { title: "b", imageUrl: "y" }], false).every((b) => b.length === 1));
check("body: title bold then description", cardBody(cards[0]!) === "*وجبة العائلة*\n٤ أشخاص بـ ٩٩ درهم");
check("body cut at 160", cardBody({ title: "x".repeat(300) }).length <= 160);
check("two cards with images are ready", carouselReady(cards).ok);
check("one card is refused", !carouselReady([cards[0]!]).ok);
check("a card without an image is refused", !carouselReady([cards[0]!, { title: "z" }]).ok);
console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
