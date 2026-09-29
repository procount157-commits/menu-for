// ── The three records a sending domain needs ─────────────────────
// Nothing here sends better email; it tells the owner why their email is
// not arriving. SPF names who may send for the domain, DKIM signs what is
// sent, DMARC says what to do when neither matches. Mailbox providers now
// refuse bulk mail without all three.

import { promises as dns } from "node:dns";

export interface DnsReport {
  domain: string;
  spf:   { found: boolean; record: string | null; ok: boolean; note: string };
  dmarc: { found: boolean; record: string | null; ok: boolean; note: string };
  dkim:  { found: boolean; selector: string | null; note: string };
  mx:    { found: boolean; hosts: string[] };
}

const SELECTORS = ["google", "default", "selector1", "selector2", "k1", "k2", "dkim", "mail", "smtp", "resend", "brevo", "s1", "s2", "zoho", "hostinger", "mailo"];

async function txt(name: string): Promise<string[]> {
  try { return (await dns.resolveTxt(name)).map((r) => r.join("")); } catch { return []; }
}

export async function checkDomain(email: string): Promise<DnsReport> {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  const [root, dmarcTxt, mx] = await Promise.all([
    txt(domain), txt(`_dmarc.${domain}`),
    dns.resolveMx(domain).catch(() => [] as Array<{ exchange: string; priority: number }>),
  ]);

  const spf = root.find((r) => /^v=spf1/i.test(r)) ?? null;
  const dmarc = dmarcTxt.find((r) => /^v=DMARC1/i.test(r)) ?? null;

  let selector: string | null = null;
  for (const s of SELECTORS) {
    const r = await txt(`${s}._domainkey.${domain}`);
    if (r.some((x) => /v=DKIM1|k=rsa|p=/i.test(x))) { selector = s; break; }
  }

  return {
    domain,
    spf: {
      found: !!spf, record: spf,
      ok: !!spf && !/\+all/.test(spf),
      note: !spf ? "لا يوجد سجل SPF — أضف TXT على الجذر مثل: v=spf1 include:<مزوّدك> ~all"
        : /\+all/.test(spf) ? "SPF يسمح للجميع (+all) — يجب أن ينتهي بـ ~all أو -all"
        : "SPF موجود",
    },
    dmarc: {
      found: !!dmarc, record: dmarc,
      ok: !!dmarc && /p=(none|quarantine|reject)/i.test(dmarc),
      note: !dmarc ? "لا يوجد DMARC — أضف TXT على _dmarc: v=DMARC1; p=none; rua=mailto:dmarc@" + domain
        : /p=none/i.test(dmarc) ? "DMARC بوضع المراقبة (p=none) — مقبول للبداية"
        : "DMARC موجود",
    },
    dkim: {
      found: !!selector, selector,
      note: selector ? `DKIM موجود (selector: ${selector})` : "لم أجد DKIM على المحددات الشائعة — فعّله من مزوّد بريدك وأضف السجل الذي يعطيك",
    },
    mx: { found: mx.length > 0, hosts: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange) },
  };
}
