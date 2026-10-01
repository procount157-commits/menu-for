// ── Menu For You's email library ──────────────────────────────────
// What the platform owner sends to shops — restaurants, cafés, sweets makers
// and salons in the UAE and the Gulf — to introduce منيو فور يو: twenty
// English templates by vertical, the intro campaign in English and Arabic,
// and the voice the team writes in.
//
// The honesty rules are the firm's old ones, carried over: no number the
// owner has not written (no "30% more sales", no "200 shops use us"), no
// fake urgency, no testimonial nobody gave. Prices, the trial's length, the
// demo menu link and the contact details are bracketed placeholders the
// owner fills in before anything goes out.

export const CONTACT = {
  website: "[رابط موقع منيو فور يو]",
  websiteLabel: "[موقع منيو فور يو]",
  phone: "[رقم واتساب المبيعات]",
  phoneLocal: "[رقم واتساب المبيعات]",
  whatsapp: "[رابط واتساب المبيعات]",
  demoMenu: "[رابط المنيو التجريبي]",
};

export const SIGNATURE = [
  `<p style="margin:16px 0 0;color:#374151;font-size:14px;line-height:1.7">`,
  `<b>Menu For You</b> · منيو فور يو<br>`,
  `Digital menu · WhatsApp orders · Queue · Bookings<br>`,
  `📞 ${CONTACT.phone} · `,
  `<a href="${CONTACT.whatsapp}" style="color:#16a34a">WhatsApp</a> · `,
  `<a href="${CONTACT.website}" style="color:#2563eb">${CONTACT.websiteLabel}</a>`,
  `</p>`,
].join("");

const p = (...xs: string[]) => xs.map((x) => `<p>${x}</p>`).join("\n");
/** A button. The link is a placeholder until the owner puts the real one in. */
export const cta = (label: string, href: string = CONTACT.demoMenu) => `<p class="cta"><a href="${href}">${label}</a></p>`;
// The call to action for each vertical: the demo menu is the strongest one,
// because a shop owner believes what they can open on their own phone.
const CTA_BY_CATEGORY: Record<string, string> = {
  "About us": "See a demo menu",
  "Restaurants": "See a demo menu",
  "Cafés": "See a demo menu",
  "Sweets": "See a demo menu",
  "Beauty": "Book a 10-minute demo",
  "General": "Start a free trial",
};
const ul = (...xs: string[]) => `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`;
const HI = "Hello {{first_name|team}},";
const BYE = "Best regards,<br>The Menu For You team";
const CALL = `reply to this email or message us on WhatsApp at ${CONTACT.phone}`;

export interface LibraryTemplate { category: string; name: string; subject: string; html: string }

// ── Twenty templates ──────────────────────────────────────────────
export const TEMPLATES: LibraryTemplate[] = [
  // About us
  { category: "About us", name: "01 · Who we are — introduction", subject: "{{company|Your shop}}'s menu, queue and orders — in one link",
    html: [p(HI), p("Menu For You (منيو فور يو) gives restaurants, cafés, sweets shops and salons one link and one QR code. It opens an elegant menu on the customer's phone — no app to download, no account to make."), p("From that same page the customer can order on WhatsApp, take a place in a digital queue, or book a table or an appointment. The order arrives on your own WhatsApp, already written out with the items and the total."), p(`The quickest way to judge it is to open one: ${CONTACT.demoMenu}. If you would like us to show you how {{company|your shop}}'s would look, a 10-minute call is enough.`), p(BYE)].join("\n") },
  { category: "About us", name: "02 · What your customer sees", subject: "What a customer at {{company|your door}} would see",
    html: [p(HI), p("A customer scans the QR on the table, the door or your Instagram, and sees:"), ul("Your menu with photos, sections and prices you keep up to date yourself", "A cart that ends in a ready-written WhatsApp message to your number", "A button to join the queue — with how many are ahead and roughly how long", "A booking or pre-order form, if you switch it on"), p("Nothing to install, and nothing for your staff to learn beyond a screen with a \"Next\" button."), p(`Would you like to see it on your own phone? ${CALL[0]!.toUpperCase() + CALL.slice(1)}.`), p(BYE)].join("\n") },
  { category: "About us", name: "03 · What we are — and what we are not", subject: "A quick note on what Menu For You does",
    html: [p(HI), p("A short clarification, because the market mixes these up: Menu For You is not a delivery app and not a cashier system."), p("It is the page your customers open before they order: the menu, the queue, the booking — and the WhatsApp conversation that follows. The orders and the customer's number come to you, on your own WhatsApp, so you keep talking to your customers directly."), p("If that fits how {{company|your shop}} works, we would be glad to show you."), p(BYE)].join("\n") },
  { category: "About us", name: "04 · After a demo — thank you", subject: "Thank you — next steps for {{company|your shop}}",
    html: [p(HI), p("Thank you for your time today. As we discussed, the next step is to put your own menu in so you can see it working with your items and prices."), p("To prepare, it helps to have: your current menu (a photo, PDF or Excel is fine), your logo, opening hours, branch addresses, and the WhatsApp number orders should go to."), p(`Send these whenever convenient, or ${CALL} if anything is unclear.`), p(BYE)].join("\n") },
  { category: "About us", name: "05 · Last note — closing the loop", subject: "Should I close this, {{first_name|}}?",
    html: [p(HI), p("I have written a couple of times about a digital menu and queue for {{company|your shop}} and have not heard back — which usually means the timing is not right."), p("I will not keep following up. If things change — a new branch, a busy season, or simply tired of reprinting menus — we are one email away."), p(BYE)].join("\n") },

  // Restaurants
  { category: "Restaurants", name: "06 · The crowd at the door", subject: "Busy evenings at {{company|your restaurant}} — where does the line go?",
    html: [p(HI), p("On a full night, the line at the door is handled by whoever is free: names on paper, \"ten more minutes\", and some people who quietly leave."), p("With Menu For You the customer takes a number from the QR at the door, sees how many are ahead, and gets a WhatsApp message «جاء دورك» when the table is ready — so they can wait in the car or the mall instead of the doorway."), p("Shall we show you how the queue screen looks for your host?"), p(BYE)].join("\n") },
  { category: "Restaurants", name: "07 · Phone orders", subject: "How many orders does {{company|your restaurant}} take by phone?",
    html: [p(HI), p("A phone order means someone stops what they are doing, writes the items down, repeats them back, and sometimes still gets one wrong."), p("With Menu For You the customer builds the order from your menu and sends it as one WhatsApp message: items, options, total and pickup, delivery or table — priced from your menu, not typed by hand."), p(`You can try it as a customer on our demo menu: ${CONTACT.demoMenu}.`), p(BYE)].join("\n") },
  { category: "Restaurants", name: "08 · Paper menus", subject: "When did {{company|your restaurant}} last reprint its menu?",
    html: [p(HI), p("A price changes, a dish is out for the day, a new item arrives — and the printed menu is wrong until the next print."), p("A Menu For You menu is changed from the phone in a minute: a price, a photo, or \"not available today\" — and every QR in the restaurant shows it straight away."), p("Would a quick look at the editor be useful?"), p(BYE)].join("\n") },
  { category: "Restaurants", name: "09 · Table bookings", subject: "Table bookings at {{company|your restaurant}} — on paper or on WhatsApp?",
    html: [p(HI), p("Bookings that live in a notebook and a dozen WhatsApp chats are easy to double up and easy to forget."), p("Menu For You takes the booking from the menu page — party size and time — and sends the customer a reminder before they come, with a simple \"I'm coming / cancel\". When they arrive, the booking goes ahead of the walk-in queue."), p("Shall we set it up on a demo so you can see it from both sides?"), p(BYE)].join("\n") },
  { category: "Restaurants", name: "10 · More than one branch", subject: "One menu, every branch of {{company|your restaurant}}",
    html: [p(HI), p("With branches, the questions multiply: which branch has which items, which number takes orders, whose queue is it."), p("In Menu For You each branch has its own queue, its own WhatsApp number if you want one, and its own staff screen — and you see all of them from one owner account."), p(`If that is the setup you run, ${CALL}.`), p(BYE)].join("\n") },

  // Cafés
  { category: "Cafés", name: "11 · The morning rush", subject: "The morning rush at {{company|your café}}",
    html: [p(HI), p("At the counter, the rush is the same few minutes every day: orders shouted over each other and people waiting without knowing whose cup is next."), p("With Menu For You the customer orders from the QR, gets a number, and a WhatsApp message when it is ready — the counter calls numbers instead of names."), p("Would you like to try it as a customer first?"), p(BYE)].join("\n") },
  { category: "Cafés", name: "12 · A menu that keeps up", subject: "{{company|Your café}}'s seasonal drinks — on the menu the same day",
    html: [p(HI), p("Cafés change their menu more than anyone: a seasonal drink, a new bean, a pastry that sold out at noon."), p("A Menu For You menu is edited from your phone, with photos and options (size, milk, extra shot), and the change shows on every QR at once."), p(`Here is a demo menu to open on your phone: ${CONTACT.demoMenu}.`), p(BYE)].join("\n") },

  // Sweets
  { category: "Sweets", name: "13 · Pre-orders for trays", subject: "Tray orders at {{company|your shop}} — written down or lost in chats?",
    html: [p(HI), p("A tray of kunafa for Thursday at five, a cake for Saturday — sweets shops live on pre-orders, and most of them arrive as scattered WhatsApp messages."), p("Menu For You lets the customer choose the tray and the pickup date from your menu and send it as one clear order. You see every pre-order by day, and the customer gets a reminder before pickup."), p("Shall we show you how the pre-order list looks?"), p(BYE)].join("\n") },
  { category: "Sweets", name: "14 · Busy seasons", subject: "Before the next busy season at {{company|your shop}}",
    html: [p(HI), p("Ramadan, Eid and wedding season bring the same problem every year: the phone does not stop, and the orders that matter get mixed up with the questions."), p("With Menu For You the questions — prices, sizes, opening hours — are answered from your menu, and the orders arrive written out with a date. Setting it up before the season means your team learns it on a quiet day."), p(`If you would like to see it, ${CALL}.`), p(BYE)].join("\n") },

  // Beauty
  { category: "Beauty", name: "15 · Appointments", subject: "Appointments at {{company|your salon}} — how are they booked today?",
    html: [p(HI), p("Most salons book by phone and WhatsApp, then keep the day in someone's head or a notebook — and the gaps and double bookings follow."), p("Menu For You shows your services with their duration and price, lets the client pick a time (and a specialist, if you want), and sends a reminder before the appointment with \"I'm coming / cancel\"."), p("Would a 10-minute demo be useful?"), p(BYE)].join("\n") },
  { category: "Beauty", name: "16 · Walk-ins waiting", subject: "Walk-in clients waiting at {{company|your salon}}",
    html: [p(HI), p("A walk-in client who waits in the reception without knowing how long is a client who may not come back."), p("With Menu For You she takes a number from the QR, sees how many are ahead, and gets a WhatsApp message when it is her turn — so she can wait in a café nearby instead."), p("Shall we show you the queue from her side and from your reception's?"), p(BYE)].join("\n") },

  // General
  { category: "General", name: "17 · Your own customer list", subject: "Who are {{company|your shop}}'s regular customers?",
    html: [p(HI), p("Most shops know their regulars by face, not by number — so when there is a new item or a quiet day, there is nobody to tell."), p("Every order, queue ticket and booking in Menu For You keeps the customer's WhatsApp number and what they came for. With the customer's agreement, you can send them a thank-you, a review request or news — from your own number."), p("Would it help to see what that list looks like?"), p(BYE)].join("\n") },
  { category: "General", name: "18 · A WhatsApp host that knows your menu", subject: "Who answers {{company|your shop}}'s WhatsApp at 11 pm?",
    html: [p(HI), p("\"Do you deliver?\", \"How much is the kunafa?\", \"Are you open Friday?\" — the same questions, all day, often when nobody is free to answer."), p("Menu For You includes a WhatsApp host that answers from your own menu, hours and branches. It does not make up a price or a dish it cannot find; it sends the menu link, the queue or the booking, and hands complaints to a person."), p(`If you would like to see it answer, ${CALL}.`), p(BYE)].join("\n") },
  { category: "General", name: "19 · Setting up in one sitting", subject: "From your current menu to a QR — what it takes",
    html: [p(HI), p("Shop owners often ask how much work the switch is. What we need from you: your current menu (a photo or PDF is fine), your logo, your hours, your branches and the WhatsApp number for orders."), p("From there you get the menu link, the QR kit to print, and a staff screen for the queue. Plans start at [monthly price], and you can try it first for [trial length]."), p(`To start, ${CALL}.`), p(BYE)].join("\n") },

  // Sales reply
  { category: "Replies", name: "20 · Reply to a pricing question", subject: "Re: pricing for {{company|your shop}}",
    html: [p(HI), p("Thank you for asking. Our plans start at [monthly price]; which one fits depends on a few things:"), ul("Restaurant, café, sweets shop or salon", "How many branches", "What you would use: menu and orders, the queue, bookings, the WhatsApp host", "Whether each branch needs its own WhatsApp number"), p(`With that we can tell you exactly which plan fits. You can reply here, or message us on WhatsApp at ${CONTACT.phone} — and you can try it for [trial length] before deciding.`), p(BYE)].join("\n") },
];

const NO_BUTTON = /^(04|05|20) ·/;
for (const t of TEMPLATES) {
  const label = CTA_BY_CATEGORY[t.category];
  if (!label || NO_BUTTON.test(t.name)) continue;
  t.html = t.html.replace(`<p>${BYE}</p>`, `${cta(label)}\n<p>${BYE}</p>`);
}

// ── The intro campaign ────────────────────────────────────────────
export interface CampaignPack { name: string; language: "en" | "ar"; subjects: [string, string]; html: string; followups: Array<{ audience: "warm" | "cold" | "all"; afterHours: number; subject: string; html: string }> }

export const INTRO_CAMPAIGN_EN: CampaignPack = {
  name: "Menu For You intro — English",
  language: "en",
  subjects: ["{{company|Your shop}}: menu, queue and WhatsApp orders in one link", "What happens to the customers who leave {{company|your}} line?"],
  html: [
    p(HI),
    p("Every busy shop has the same few problems: a crowd at the door, customers who give up and walk away, orders taken by phone, menus that are out of date the day they are printed — and no list of who the customers actually are."),
    p("Menu For You puts one link and one QR in front of your customers. It opens:"),
    ul("An elegant menu with photos and prices you update from your phone", "Orders that arrive on your WhatsApp, written out and priced from your menu", "A digital queue that messages the customer «جاء دورك» when it is their turn", "Bookings and pre-orders, for every branch you run"),
    p(`The easiest way to judge it is to open a demo menu on your own phone. Or ${CALL} and we will show you {{company|your shop}}'s in 10 minutes.`),
    cta("See a demo menu"),
    p(BYE),
  ].join("\n"),
  followups: [
    { audience: "warm", afterHours: 72, subject: "{{company|Your shop}}: the queue, from the customer's side",
      html: [p(HI), p("Following up on my note about Menu For You — the part owners ask about most is the queue."), p("The customer scans the QR at the door, takes a number, and sees how many are ahead of them. Your host presses \"Next\", and the customer gets a WhatsApp message «جاء دورك». They can wait in the car instead of the doorway."), p("If you would like, we can set up a demo with your own menu so you see it working with your items. A 10-minute call is enough to start."), cta("Book a 10-minute demo", CONTACT.whatsapp), p(BYE)].join("\n") },
    { audience: "cold", afterHours: 96, subject: "A 4-question check for {{company|your shop}}",
      html: [p(HI), p("A quick self-check:"), ul("Do customers ever leave because the wait is unclear?", "How many orders do you still take by phone?", "When did you last reprint the menu for a price change?", "Could you message your regular customers today if you wanted to?"), p(`If any answer made you pause, Menu For You may help. ${CALL[0]!.toUpperCase() + CALL.slice(1)}.`), cta("See a demo menu"), p(BYE)].join("\n") },
    { audience: "all", afterHours: 168, subject: "Closing the loop for {{company|your shop}}",
      html: [p(HI), p("I have written a couple of times about a digital menu and queue for {{company|your shop}} and will not keep filling your inbox."), p("If a new branch, a busy season or a menu change comes up, we are one email or WhatsApp away."), p(BYE)].join("\n") },
  ],
};

const HI_AR = "هلا فريق {{company|محلكم}}،";
const BYE_AR = "مع التحية،<br>فريق منيو فور يو";
const CALL_AR = `ردّوا على هالرسالة أو راسلونا على واتساب ${CONTACT.phoneLocal}`;

export const INTRO_CAMPAIGN_AR: CampaignPack = {
  name: "تعريف منيو فور يو — عربي",
  language: "ar",
  subjects: ["{{company|محلكم}}: المنيو والدور وطلبات واتساب في رابط واحد", "وين يروحون الزباين اللي يملّون من الانتظار عند {{company|محلكم}}؟"],
  html: [
    p(HI_AR),
    p("أي محل عليه زحمة يعرف هالمشاكل: ناس واقفين عند الباب، زباين يملّون ويمشون، طلبات بالتلفون تنكتب وتنعاد، منيو مطبوع يصير قديم أول ما يتغيّر سعر — وما عندك قائمة بزباينك الحقيقيين."),
    p("منيو فور يو يعطيك رابط واحد وQR واحد، يفتح للزبون:"),
    ul("منيو أنيق بالصور والأسعار، تعدّله من جوالك", "طلب يوصلك على واتساب مكتوب ومحسوب من المنيو", "صف انتظار رقمي، والزبون توصله رسالة «جاء دورك» على واتساب", "حجوزات وطلبات مسبقة، لكل فروعك"),
    p(`أسهل طريقة تحكمون فيها: افتحوا منيو تجريبي من جوالكم. أو ${CALL_AR} ونوريكم شكل منيو {{company|محلكم}} في عشر دقايق.`),
    cta("شوف منيو تجريبي"),
    p(BYE_AR),
  ].join("\n"),
  followups: [
    { audience: "warm", afterHours: 72, subject: "{{company|محلكم}}: الدور من جهة الزبون",
      html: [p(HI_AR), p("متابعة لرسالتي عن منيو فور يو — أكثر شي يسألون عنه أصحاب المحلات هو الدور."), p("الزبون يمسح الـ QR عند الباب، ياخذ رقم، ويشوف كم واحد قدامه. الموظف يضغط «التالي»، ويوصل الزبون واتساب «جاء دورك». يقدر ينتظر في سيارته بدل ما يوقف عند الباب."), p("إذا تحبون، نجهّز لكم نسخة تجريبية بمنيوكم أنتم وتشوفونها شغّالة بأصنافكم. مكالمة عشر دقايق تكفي."), cta("احجزوا عرض ١٠ دقايق", CONTACT.whatsapp), p(BYE_AR)].join("\n") },
    { audience: "cold", afterHours: 96, subject: "٤ أسئلة سريعة لـ {{company|محلكم}}",
      html: [p(HI_AR), p("فحص سريع:"), ul("هل فيه زباين يمشون لأنهم ما يعرفون كم بينتظرون؟", "كم طلب للحين تاخذونه بالتلفون؟", "متى آخر مرة طبعتوا المنيو عشان تغيّر سعر؟", "لو تبون اليوم تراسلون زباينكم الدايمين، تقدرون؟"), p(`إذا وقفتك وحدة من هالأسئلة، منيو فور يو ممكن يساعد — ${CALL_AR}.`), cta("شوف منيو تجريبي"), p(BYE_AR)].join("\n") },
    { audience: "all", afterHours: 168, subject: "آخر رسالة مني لـ {{company|محلكم}}",
      html: [p(HI_AR), p("راسلتكم مرتين عن المنيو الرقمي والدور، وما راح أزحم بريدكم أكثر."), p("إذا فتحتوا فرع جديد، أو جاكم موسم زحمة، أو تعبتوا من طباعة المنيو — نحن على بُعد رسالة أو واتساب."), p(BYE_AR)].join("\n") },
  ],
};

// ── How the team writes ──────────────────────────────────────────
export const VOICE_GUIDE = `Menu For You — email voice guide (how we write)

Who we are, in one line: one link and one QR that opens a shop's menu, takes its orders on WhatsApp, runs its queue and its bookings.
Short version: Menu For You (منيو فور يو) gives restaurants, cafés, sweets shops and salons in the UAE and the Gulf an elegant digital menu with WhatsApp ordering, a digital queue that messages «جاء دورك», bookings and pre-orders, branches under one account, and a WhatsApp host that answers from the menu.
Contact: ${CONTACT.websiteLabel} · ${CONTACT.phone} (WhatsApp) · demo menu: ${CONTACT.demoMenu}.

How every email is built: Subject → one problem the shop lives every day (the crowd at the door, walk-aways, phone orders, paper menus, no customer list) → what that costs them in their own terms → what Menu For You does about it, concretely → one call to action.
Show first, explain second: a demo menu they open on their own phone beats any paragraph.

Tone in English: warm, plain, practical — written to a shop owner, not a corporate buyer. No advertising language.
Tone in Arabic: natural Gulf Arabic, short sentences, the way an owner talks to a supplier he trusts — not formal, not salesy.

Always: the shop's name in the subject or first line; their vertical's problem (a salon is not a restaurant); one call to action; signed as Menu For You.
Calls to action: cold — see a demo menu; warm — a 10-minute demo; ready — start a free trial. The demo link, the trial's length and every price are placeholders in brackets the owner fills in.

Never: best, No.1, cheapest, leading, guaranteed, 100%; any invented number — no "30% more sales", no "200 shops use us", no "customers wait half as long"; a testimonial or a customer name nobody gave; fake urgency (no "offer ends today"); a claim about a competitor; promising a feature the shop has not been shown.

Pricing questions: never invent a figure — use the owner's [monthly price] placeholder, ask the vertical, the branches and which parts they would use, then offer the trial.
"We already use a delivery app": "That can stay. Menu For You is for the customers already at your door, on your table or on your Instagram — the orders come to your own WhatsApp."
"We already have a QR menu": "Then you know the idea. The difference is what happens after the menu: the order on WhatsApp, the queue, the bookings."
"My staff won't use it": the staff screen is one button — "Next" — and a list of orders.`;
