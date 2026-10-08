// The email the owner asked for — the point in two or three lines, the
// button under them, the detail for whoever reads on — and the team that
// works without being asked: a wave per sector with that sector's campaign,
// none for firms that are not shops, ماجد's checks, and the leftovers of
// deleted campaigns that used to stall everything.

export {};
const { toHtml } = await import("../email/agent");
const { skimFirst, styleBody, brandOf } = await import("../email/layout");
const { formatIssues } = await import("../email/team");
const { campaignForSector, hasOwnCampaign, fitsProduct, MAX_SECTOR_WAVES, MIN_SECTOR, DEFAULT_GOAL } = await import("../email/autopilot");
const { sameLists } = await import("../email/caretaker");
const { riskOf, byRisk } = await import("../email/hygiene");

let pass = 0, total = 0;
const check = (n: string, c: boolean, d = "") => { total++; if (c) pass++; console.log(`${c ? "✅" : "❌"} ${n.padEnd(64)} ${d}`); };

// ── The writer's marks ───────────────────────────────────────────
const html = toHtml([
  "هلا {{company|محلكم}}،",
  "",
  "[ملخص] زحمة الباب وقت العشاء تضيّع عليكم زباين. منيو فور يو يعطيهم دوراً من الـ QR ويرسل «جاء دورك» على واتساب.",
  "",
  "[زر] شوف منيو تجريبي",
  "",
  "[تفاصيل]",
  "- الزبون ياخذ دوره من جواله",
  "- يوصله «جاء دورك» على واتساب",
  "",
  "منيو فور يو",
].join("\n"));
check("the summary becomes the lead", /<p class="lead">زحمة الباب/.test(html));
check("the details mark becomes the divider", html.includes('<hr class="more">'));
check("the button follows the summary", html.indexOf('class="cta"') > html.indexOf('class="lead"') && html.indexOf('class="cta"') < html.indexOf('class="more"'));
check("a bare [See a demo menu] is a button, not bracketed text", toHtml("[See a demo menu]").includes('<p class="cta"><a href="#cta">See a demo menu</a></p>'));
check("...and so is an Arabic one", toHtml("[شوف منيو تجريبي]").includes('<p class="cta"><a href="#cta">شوف منيو تجريبي</a></p>'));

// ── The order, enforced ──────────────────────────────────────────
const late = '<p class="lead">Gist.</p><hr class="more"><ul><li>a</li></ul><p class="cta"><a href="x">Go</a></p>';
const fixed = skimFirst(late);
check("a button written at the bottom moves up under the summary", fixed.indexOf("cta") < fixed.indexOf("more") && fixed.indexOf("cta") > fixed.indexOf("lead"));
check("a message without a summary is left as written", skimFirst("<p>a</p><p class=\"cta\"><a href=\"x\">b</a></p>") === "<p>a</p><p class=\"cta\"><a href=\"x\">b</a></p>");
const styled = styleBody(html, brandOf({ brandName: "Menu For You" }), "rtl");
check("the divider is labelled for the reader, in Arabic for an Arabic email", styled.includes("التفاصيل لمن يرغب") && !styled.includes("<hr"));
check("...in English for an English one", styleBody('<p class="lead">Gist</p><hr class="more">', brandOf(null), "ltr").includes("In more detail"));

// ── ماجد's check of the shape ────────────────────────────────────
check("the right shape passes", formatIssues(html).length === 0, formatIssues(html).join(" | "));
const wall = `<p>Hello,</p><p>${"word ".repeat(220)}</p><p class="cta"><a href="x">Go</a></p>`;
const w = formatIssues(wall);
check("a wall of text is caught: no summary, too long", w.some((i) => i.includes("لا ملخص")) && w.some((i) => i.includes("كلمة")));
check("a summary of 80 words is too long", formatIssues(`<p class="lead">${"w ".repeat(80)}</p><p class="cta"><a href="x">b</a></p>`).some((i) => i.includes("الملخص")));
check("a follow-up is held to the short form", formatIssues(`<p class="lead">${"w ".repeat(40)}</p><p>${"w ".repeat(70)}</p><p class="cta"><a href="x">b</a></p>`, "followup").some((i) => i.includes("٧٠")));
check("no button is named", formatIssues('<p class="lead">gist</p>').some((i) => i.includes("زر")));

// ── سلمى's waves by sector ───────────────────────────────────────
check("each shop sector gets its own campaign", campaignForSector("حلويات").includes("الطلبات المسبقة") && campaignForSector("تجميل وصالونات").includes("الصالونات") && campaignForSector("كافيهات").includes("الكافيهات"));
check("the old «restaurants and cafés» label still gets the restaurant campaign", campaignForSector("مطاعم ومقاهي") === campaignForSector("مطاعم"));
check("a shop sector with none in the library gets the general introduction", campaignForSector("أغذية") === DEFAULT_GOAL && !hasOwnCampaign("أغذية") && hasOwnCampaign("مطاعم"));
check("firms that are not shops get no wave", !fitsProduct("عقارات") && !fitsProduct("محاسبة وتدقيق") && fitsProduct("مطاعم") && fitsProduct("أغذية"));
check("at most three sector waves per list, fifteen to be worth one", MAX_SECTOR_WAVES === 3 && MIN_SECTOR === 15);

// ── The same people twice ────────────────────────────────────────
const twins = sameLists([{ id: 25, name: "Dubai restaurants", n: 820, sig: "abc" }, { id: 26, name: "Dubai restaurants — مطاعم", n: 820, sig: "abc" }, { id: 7, name: "ALL", n: 3852, sig: "xyz" }]);
check("two lists with the same people are found", twins.length === 1 && twins[0]![0].id === 25 && twins[0]![1].id === 26);
check("an empty list is no one's twin", sameLists([{ id: 1, name: "a", n: 0, sig: "e" }, { id: 2, name: "b", n: 0, sig: "e" }]).length === 0);

// ── The risk ماجد reads ──────────────────────────────────────────
const signals = new Map([["bigchain.ae", { n: 30, bounced: 1 }], ["cafe.ae", { n: 2, bounced: 0 }], ["group.ae", { n: 20, bounced: 0 }]]);
check("a personal mailbox where another bounced is high risk", riskOf({ email: "ahmed@bigchain.ae", mxOk: true, status: "active" } as any, signals) === "high");
check("a dead domain is high risk", riskOf({ email: "x@nowhere.ae", mxOk: false, status: "active" } as any, signals) === "high");
check("info@ rarely bounces", riskOf({ email: "info@bigchain.ae", mxOk: true, status: "active" } as any, signals) === "low");
check("a big company's personal mailbox is medium", riskOf({ email: "sara@group.ae", mxOk: true, status: "active" } as any, signals) === "medium");
const ordered = byRisk([{ email: "ahmed@bigchain.ae", mxOk: true, status: "active" }, { email: "sara@group.ae", mxOk: true, status: "active" }, { email: "info@cafe.ae", mxOk: true, status: "active" }] as any, signals, true);
check("lowest risk first, the riskiest held", ordered.held === 1 && ordered.kept[0]!.email === "info@cafe.ae" && ordered.kept.length === 2);

console.log(`\n${pass}/${total} مرّ`);
process.exit(pass === total ? 0 : 1);
