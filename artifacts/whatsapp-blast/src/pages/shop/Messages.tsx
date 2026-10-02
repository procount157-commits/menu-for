// ── /messages — what WhatsApp says on the shop's behalf ───────────
// The owner rewrites each automatic message in their own voice, sees it as
// the customer will, and can check what was actually sent and why something
// was not. The «why not» matters: most skips are the safety rules working.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { toast } from "sonner";
import { CheckCheck, Loader2, MessageSquareText, RotateCcw, Save, ShieldCheck, Star, HeartHandshake, History, AlertTriangle, CircleSlash, Send } from "lucide-react";
import { formatMoney, renderTemplate, type TemplateVars } from "@workspace/menu-shared";
import { get, patch, put, useShop } from "@/lib/shop-api";
import { Switch } from "@/components/ui/switch";
import { Btn, Empty, Stat, clock, errText, isPlanError, shortDate } from "@/components/shop/ops/kit";
import { cn } from "@/lib/utils";

interface Tpl { key: string; label: string; marketing: boolean; textAr: string; textEn: string; enabled: boolean; customised: boolean; defaultAr: string; defaultEn: string }
interface TplResp { templates: Tpl[]; vars: Array<{ key: string; en: string; label: string }>; features: { reviews: boolean; winback: boolean } }
interface Notif { id: number; phone: string; kind: string; text: string; class: string; status: "queued" | "sent" | "failed" | "skipped"; reason: string | null; createdAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null }
interface NotifResp { recent: Notif[]; stats: Array<{ status: string; reason: string | null; n: number }> }

const REASON: Record<string, string> = {
  no_thread: "الزبون لم يراسلنا",
  expired: "انتهت صلاحيتها",
  wa_disconnected: "واتساب غير متصل",
  opted_out: "الزبون طلب عدم المراسلة",
  daily_cap: "وصلنا الحد اليومي",
  plan: "غير متاح في الخطة",
  superseded: "حلّت محلها رسالة أحدث",
  ops_hold: "إيقاف مؤقت لحماية الرقم",
};
const ALERTS: Record<string, string> = { alert_order: "تنبيه المحل: طلب جديد", alert_booking: "تنبيه المحل: حجز جديد", alert_rating: "تنبيه المحل: تقييم", alert_campaign: "تنبيه المحل: الحملة الأسبوعية" };
const STATUS: Record<Notif["status"], { label: string; cls: string }> = {
  sent: { label: "أُرسلت", cls: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "فشلت", cls: "bg-red-500/15 text-red-300" },
  skipped: { label: "لم تُرسل", cls: "bg-secondary text-muted-foreground" },
  queued: { label: "في الانتظار", cls: "bg-sky-500/15 text-sky-300" },
};

const GROUPS: Array<{ label: string; test: (k: string) => boolean }> = [
  { label: "الصف", test: (k) => k.startsWith("queue_") || k === "status_reply" },
  { label: "الطلبات", test: (k) => k.startsWith("order_") },
  { label: "الحجوزات", test: (k) => k.startsWith("booking_") },
  { label: "بعد الزيارة", test: (k) => k === "review_request" || k === "winback" },
];

export default function Messages() {
  const [tab, setTab] = useState<"templates" | "log">("templates");
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold">رسائل واتساب</h1>
          <p className="text-sm text-muted-foreground mt-0.5">الرسائل التلقائية التي تصل زبائنك من رقم المحل.</p>
        </div>
        <div className="flex rounded-xl bg-secondary p-1 gap-1">
          <button onClick={() => setTab("templates")} className={cn("px-4 h-9 rounded-lg text-sm flex items-center gap-1.5", tab === "templates" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}><MessageSquareText className="w-4 h-4" />القوالب</button>
          <button onClick={() => setTab("log")} className={cn("px-4 h-9 rounded-lg text-sm flex items-center gap-1.5", tab === "log" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}><History className="w-4 h-4" />سجل الإرسال</button>
        </div>
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <p className="text-sm leading-relaxed text-foreground/90">
          نرسل فقط لمن راسلنا أولاً أو كتب رقمه بنفسه وطلب أن نبلغه — رسالة الانضمام التي يرسلها الزبون تفتح المحادثة، وردّنا يأتي داخلها.
          هذا ما يحمي رقم محلك من الحظر: واتساب يعاقب الأرقام التي تراسل أشخاصاً لم يتواصلوا معها، ولا يعاقب من يرد على زبائنه.
          لذلك قد ترى في السجل رسائل «لم تُرسل» لأن الزبون لم يرسل رسالته — دوره محفوظ، وصفحة التذكرة تتابعه بدلاً منها.
        </p>
      </div>

      {tab === "templates" ? <Templates /> : <Log />}
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────

function Templates() {
  const shop = useShop();
  const qc = useQueryClient();
  const data = useQuery<TplResp>({ queryKey: ["/api/wa-templates"], queryFn: () => get("/api/wa-templates") });
  const [key, setKey] = useState<string | null>(null);
  const [features, setFeatures] = useState<{ reviews: boolean; winback: boolean } | null>(null);
  useEffect(() => { if (data.data) setFeatures(data.data.features); }, [data.data]);

  if (data.isLoading) return <div className="py-16 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (data.error) return <Empty title="تعذّر تحميل القوالب" icon={<AlertTriangle />}>{errText(data.error)}</Empty>;
  const all = data.data!.templates;
  const current = all.find((t) => t.key === key) ?? all[0]!;

  const toggleFeature = async (k: "reviews" | "winback", v: boolean) => {
    const prev = features;
    setFeatures((f) => (f ? { ...f, [k]: v } : f));
    try { await patch("/api/wa-templates/features", { [k]: v }); toast.success(v ? "فُعّلت" : "أُوقفت"); }
    catch (e) { setFeatures(prev); toast.error(isPlanError(e) ? "هذه الميزة في خطة أعلى" : errText(e)); }
  };

  return (
    <div className="space-y-4">
      {!shop.plan.features.notify && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300" />
          <span className="flex-1">إشعارات واتساب غير مفعّلة في خطتك الحالية ({shop.plan.planName}) — تقدر تجهّز الرسائل الآن، وتبدأ بالوصول بعد الترقية.</span>
          <Link href="/shop/settings" className="text-primary underline underline-offset-4">الخطة</Link>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <FeatureSwitch icon={<Star className="w-5 h-5" />} title="طلب التقييم بعد الزيارة"
          text="بعد الزيارة: «شكراً، كيف كانت تجربتك؟» — بنفس قواعد الإرسال الآمن أعلاه."
          on={!!features?.reviews} onChange={(v) => toggleFeature("reviews", v)} />
        <FeatureSwitch icon={<HeartHandshake className="w-5 h-5" />} title="رسالة «اشتقنا لك»"
          text="لمن غاب 30 يوماً، وفقط لمن وافق بنفسه على استلام العروض."
          on={!!features?.winback} onChange={(v) => toggleFeature("winback", v)} plan={!shop.plan.features.marketing} />
      </div>

      <div className="grid md:grid-cols-[15rem_minmax(0,1fr)] gap-4">
        <nav className="rounded-xl border border-card-border bg-card p-2 space-y-3 md:max-h-[70vh] md:overflow-y-auto">
          {GROUPS.map((g) => {
            const ts = all.filter((t) => g.test(t.key));
            if (!ts.length) return null;
            return (
              <div key={g.label}>
                <div className="text-[11px] text-muted-foreground px-2 mb-1">{g.label}</div>
                {ts.map((t) => (
                  <button key={t.key} onClick={() => setKey(t.key)}
                    className={cn("w-full text-start px-2.5 py-2 rounded-lg text-sm flex items-center gap-2",
                      t.key === current.key ? "bg-primary/15 text-primary font-semibold" : "hover:bg-secondary/60")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.enabled ? "bg-emerald-400" : "bg-muted-foreground/40")} />
                    <span className="flex-1 truncate">{t.label}</span>
                    {t.customised && <span className="text-[10px] text-muted-foreground">معدّل</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <Editor key={current.key} t={current} vars={data.data!.vars}
          onSaved={(templates) => qc.setQueryData<TplResp>(["/api/wa-templates"], (d) => (d ? { ...d, templates } : d))} />
      </div>
    </div>
  );
}

function FeatureSwitch({ icon, title, text, on, onChange, plan }: { icon: React.ReactNode; title: string; text: string; on: boolean; onChange: (v: boolean) => void; plan?: boolean }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 flex gap-3">
      <div className="text-primary shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{text}</div>
        {plan && <div className="text-[11px] text-amber-300 mt-1">ضمن خطة «أعمال».</div>}
      </div>
      <Switch checked={on} onCheckedChange={onChange} dir="ltr" />
    </div>
  );
}

function Editor({ t, vars, onSaved }: { t: Tpl; vars: TplResp["vars"]; onSaved: (templates: Tpl[]) => void }) {
  const shop = useShop();
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [ar, setAr] = useState(t.textAr);
  const [en, setEn] = useState(t.textEn);
  const [enabled, setEnabled] = useState(t.enabled);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = ar !== t.textAr || en !== t.textEn || enabled !== t.enabled;

  const sample: TemplateVars = useMemo(() => ({
    name: lang === "ar" ? "أحمد" : "Ahmed", number: "A-27", ahead: 4, eta: lang === "ar" ? "~10–15 دقيقة" : "~10–15 min",
    branch: shop.branch.name, shop: shop.org.name, link: `${location.origin}/t/7F3K9`,
    details: lang === "ar" ? "2× كنافة نابلسية\n1× شاي كرك" : "2× Kunafa\n1× Karak tea", total: formatMoney(48, shop.org.currency, lang),
  }), [lang, shop]);

  const text = lang === "ar" ? ar : en;
  const setText = lang === "ar" ? setAr : setEn;

  const insert = (token: string) => {
    const el = ref.current;
    const v = `{${token}}`;
    if (!el) { setText(text + v); return; }
    const s = el.selectionStart ?? text.length, e = el.selectionEnd ?? text.length;
    const next = text.slice(0, s) + v + text.slice(e);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + v.length, s + v.length); });
  };

  const save = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      const r = await put<{ templates: Tpl[] }>(`/api/wa-templates/${t.key}`, body);
      onSaved(r.templates);
      const fresh = r.templates.find((x) => x.key === t.key);
      if (fresh) { setAr(fresh.textAr); setEn(fresh.textEn); setEnabled(fresh.enabled); }
      toast.success(msg);
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold">{t.label}</div>
          {t.marketing && <div className="text-xs text-amber-300 mt-0.5">رسالة تسويقية — تصل فقط لمن وافق على العروض.</div>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{enabled ? "مفعّلة" : "متوقفة"}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} dir="ltr" />
        </label>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_18rem] gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex rounded-lg bg-secondary p-0.5 gap-0.5 w-fit">
            {(["ar", "en"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={cn("px-3 h-8 rounded-md text-xs", lang === l ? "bg-background text-foreground font-semibold" : "text-muted-foreground")}>{l === "ar" ? "العربية" : "English"}</button>
            ))}
          </div>
          <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={10} dir={lang === "ar" ? "rtl" : "ltr"}
            className="w-full px-3 py-2.5 bg-input border border-border rounded-lg text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
          <div>
            <div className="text-[11px] text-muted-foreground mb-1.5">اضغط لإدراج متغيّر مكان المؤشر:</div>
            <div className="flex flex-wrap gap-1.5">
              {vars.map((v) => (
                <button key={v.key} type="button" onClick={() => insert(lang === "ar" ? v.key : v.en)} title={v.label}
                  className="text-xs rounded-full border border-primary/30 bg-primary/10 text-primary px-2.5 py-1 hover:bg-primary/20">
                  {`{${lang === "ar" ? v.key : v.en}}`}<span className="text-muted-foreground ms-1">{v.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[11px] text-muted-foreground mb-1.5">هكذا تظهر للزبون (بأمثلة)</div>
          <div className="rounded-2xl p-3 bg-[#0b141a] min-h-40">
            <div className={cn("max-w-[95%] rounded-xl rounded-tr-sm px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-[#e9edef] bg-[#005c4b] shadow", lang === "en" ? "ltr text-left mr-auto" : "ms-auto")} dir={lang === "ar" ? "rtl" : "ltr"}>
              {renderTemplate(text, sample) || <span className="opacity-60">فارغة</span>}
              <div className="text-[10px] text-[#8696a0] mt-1 flex items-center justify-end gap-1">{clock(new Date())}<CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" /></div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn tone="gold" disabled={!dirty || busy} onClick={() => save({ textAr: ar, textEn: en, enabled }, "حُفظت الرسالة")}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}حفظ
        </Btn>
        {dirty && <Btn tone="ghost" onClick={() => { setAr(t.textAr); setEn(t.textEn); setEnabled(t.enabled); }}>تراجع عن التعديل</Btn>}
        <div className="flex-1" />
        {t.customised && (
          <Btn tone="ghost" disabled={busy} onClick={() => { if (confirm("إرجاع هذه الرسالة لنصّها الأصلي؟")) void save({ reset: true }, "رجعت للنص الأصلي"); }}>
            <RotateCcw className="w-4 h-4" />النص الأصلي
          </Btn>
        )}
      </div>
    </div>
  );
}

// ── What was sent ─────────────────────────────────────────────────

function Log() {
  const shop = useShop();
  const tz = shop.org.timezone;
  const data = useQuery<NotifResp>({ queryKey: ["/api/notifications"], queryFn: () => get("/api/notifications"), refetchInterval: 30_000 });
  const tpls = useQuery<TplResp>({ queryKey: ["/api/wa-templates"], queryFn: () => get("/api/wa-templates") });
  const [filter, setFilter] = useState<"all" | Notif["status"]>("all");
  const [open, setOpen] = useState<number | null>(null);
  const label = (k: string) => tpls.data?.templates.find((t) => t.key === k)?.label ?? ALERTS[k] ?? k;

  if (data.isLoading) return <div className="py-16 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (data.error) return <Empty title="تعذّر تحميل السجل" icon={<AlertTriangle />}>{errText(data.error)}</Empty>;

  const stats = data.data!.stats;
  const sum = (st: string) => stats.filter((s) => s.status === st).reduce((a, b) => a + b.n, 0);
  const skippedBy = stats.filter((s) => s.status === "skipped").sort((a, b) => b.n - a.n);
  const rows = data.data!.recent.filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground mb-2">آخر 24 ساعة</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="أُرسلت" value={sum("sent")} tone="ok" />
          <Stat label="لم تُرسل" value={sum("skipped")} hint={skippedBy[0] ? `أغلبها: ${REASON[skippedBy[0].reason ?? ""] ?? skippedBy[0].reason ?? "—"}` : undefined} />
          <Stat label="فشلت" value={sum("failed")} tone={sum("failed") ? "warn" : undefined} />
          <Stat label="في الانتظار" value={sum("queued")} />
        </div>
        {skippedBy.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {skippedBy.map((s) => <span key={s.reason ?? "x"} className="text-xs rounded-full bg-secondary px-2.5 py-1">{REASON[s.reason ?? ""] ?? s.reason ?? "بدون سبب"} <span className="tabular-nums text-muted-foreground">{s.n}</span></span>)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {(["all", "sent", "skipped", "failed", "queued"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("px-3 h-9 rounded-lg text-sm", filter === f ? "bg-primary text-primary-foreground font-semibold" : "bg-secondary text-muted-foreground")}>
            {f === "all" ? "الكل" : STATUS[f].label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-card-border bg-card divide-y divide-border/60">
        {rows.length === 0 ? <Empty title="لا رسائل بعد" icon={<Send />}>أول ما ينضم زبون للصف ويرسل رسالته، تظهر الردود هنا.</Empty>
          : rows.map((r) => (
            <button key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-start px-3 py-2.5 hover:bg-secondary/30">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={cn("text-[11px] rounded-full px-2 py-0.5", STATUS[r.status]?.cls)}>{STATUS[r.status]?.label ?? r.status}</span>
                {r.status === "sent" && (r.readAt
                  ? <span className="text-[11px] text-sky-300 flex items-center gap-0.5" title={`فُتحت ${clock(r.readAt, tz)}`}><CheckCheck className="w-3.5 h-3.5" />فُتحت</span>
                  : r.deliveredAt ? <span className="text-[11px] text-muted-foreground flex items-center gap-0.5"><CheckCheck className="w-3.5 h-3.5" />وصلت</span> : null)}
                <span className="font-medium">{label(r.kind)}</span>
                <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">{r.phone}</span>
                {r.reason && r.status !== "sent" && <span className="text-xs text-amber-300/90 flex items-center gap-1"><CircleSlash className="w-3 h-3" />{REASON[r.reason] ?? r.reason}</span>}
                <span className="flex-1" />
                <span className="text-xs text-muted-foreground tabular-nums">{shortDate(r.createdAt, tz)} {clock(r.createdAt, tz)}</span>
              </div>
              <div className={cn("text-xs text-muted-foreground mt-1 whitespace-pre-wrap", open === r.id ? "" : "line-clamp-1")}>{r.text}</div>
            </button>
          ))}
      </div>
    </div>
  );
}
