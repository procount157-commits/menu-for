// ── /customers — the people who came back ─────────────────────────
// Everyone who joined the queue, ordered or booked with a WhatsApp number,
// one row per phone. The drawer is the shop's memory of a regular: what they
// order, how often they come, whether they turned up.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";
import { Download, Loader2, Search, Star, Users, Repeat, BellRing, Pencil, Check, X, ShoppingBag, CalendarDays, ListOrdered, UserX, Megaphone } from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { get, patch, useShop, inputCls } from "@/lib/shop-api";
import { useAuth } from "@/context/AuthContext";
import { Btn, Empty, Stat, clock, errText, n, shortDate } from "@/components/shop/ops/kit";
import { Drawer } from "@/components/shop/ops/Modal";
import { cn } from "@/lib/utils";

interface Customer {
  orgId: number; phone: string; name: string | null; firstSeenAt: string; lastSeenAt: string; lastInboundAt: string | null;
  visits: number; ordersCount: number; bookingsCount: number; noShows: number; totalSpent: number;
  favourites: Record<string, number>; marketingOptIn: boolean; optInAt: string | null; ratingLast: number | null;
}
interface ListResp { customers: Customer[]; stats: { total: number; optedIn: number; returning: number; avgRating: number | string | null } }
interface Detail {
  customer: Customer;
  tickets: Array<{ id: number; displayCode: string; status: string; joinedAt: string; calledAt: string | null; partySize: number }>;
  orders: Array<{ id: number; code: string; status: string; type: string; subtotal: number; createdAt: string; items: Array<{ itemId: number; name: string; qty: number }> }>;
  bookings: Array<{ id: number; code: string; status: string; startsAt: string; partySize: number }>;
}

type Sort = "recent" | "visits" | "spent";

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export default function Customers() {
  const shop = useShop();
  const { user } = useAuth();
  const owner = (user?.role ?? shop.role) === "owner";
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [optIn, setOptIn] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const money = (v: number) => formatMoney(v, shop.org.currency);

  const params = new URLSearchParams({ sort, ...(dq ? { q: dq } : {}), ...(optIn ? { optIn: "1" } : {}) });
  const list = useQuery<ListResp>({ queryKey: ["/api/customers", params.toString()], queryFn: () => get(`/api/customers?${params}`), placeholderData: (p) => p });

  const s = list.data?.stats;
  const rows = list.data?.customers ?? [];
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold">الزبائن</h1>
          <p className="text-sm text-muted-foreground mt-0.5">كل من انضم للصف أو طلب أو حجز برقم واتساب.</p>
        </div>
        {owner && (
          <Link href="/wa-auto" className="inline-flex items-center gap-2 rounded-xl px-4 min-h-10 text-sm font-semibold bg-primary text-primary-foreground hover:brightness-110">
            <Megaphone className="w-4 h-4" />حملة لشريحة
          </Link>
        )}
        {owner && (
          <a href="/api/customers-export.csv" className="inline-flex items-center gap-2 rounded-xl px-4 min-h-10 text-sm font-semibold bg-secondary border border-border hover:bg-secondary/80">
            <Download className="w-4 h-4" />تصدير CSV
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="كل الزبائن" value={n(s?.total)} />
        <Stat label="رجعوا أكثر من مرة" value={n(s?.returning)} hint={s?.total ? `${Math.round(((s.returning ?? 0) / s.total) * 100)}% من الكل` : undefined} tone="gold" />
        <Stat label="وافقوا على العروض" value={n(s?.optedIn)} hint="فقط هؤلاء تصلهم الحملات" />
        <Stat label="متوسط التقييم" value={s?.avgRating ? <span className="flex items-center gap-1">{Number(s.avgRating).toFixed(1)}<Star className="w-4 h-4 fill-primary text-primary" /></span> : "—"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
          <input className={cn(inputCls, "ps-9 py-2.5")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرقم" type="search" />
        </div>
        <div className="flex rounded-xl bg-secondary p-1 gap-1">
          {([["recent", "الأحدث"], ["visits", "الأكثر زيارة"], ["spent", "الأعلى صرفاً"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className={cn("px-3 h-9 rounded-lg text-sm", sort === k ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <button onClick={() => setOptIn((v) => !v)}
          className={cn("px-3 h-11 rounded-xl text-sm border flex items-center gap-1.5", optIn ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
          <BellRing className="w-4 h-4" />الموافقون على العروض فقط
        </button>
      </div>

      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        {list.isLoading ? <div className="py-16 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          : rows.length === 0 ? (
            <Empty title={dq || optIn ? "لا نتائج" : "لا زبائن بعد"} icon={<Users />}>
              {dq || optIn ? "جرّب بحثاً آخر." : "أول ما ينضم زبون للصف أو يطلب برقم واتساب، يظهر هنا مع زياراته وطلباته."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr className="[&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium [&>th]:text-start">
                    <th>الزبون</th><th>زيارات</th><th>طلبات</th><th>حجوزات</th><th>لم يحضر</th><th>الإنفاق</th><th>آخر ظهور</th><th>العروض</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.phone} onClick={() => setOpen(c.phone)} className="border-b border-border/60 last:border-0 hover:bg-secondary/40 cursor-pointer [&>td]:px-3 [&>td]:py-2.5">
                      <td>
                        <div className="font-medium">{c.name || "بدون اسم"}</div>
                        <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">{intl(c.phone)}</div>
                      </td>
                      <td className="tabular-nums">{c.visits}</td>
                      <td className="tabular-nums">{c.ordersCount}</td>
                      <td className="tabular-nums">{c.bookingsCount}</td>
                      <td className={cn("tabular-nums", c.noShows > 0 && "text-amber-400")}>{c.noShows}</td>
                      <td className="tabular-nums whitespace-nowrap">{c.totalSpent ? money(c.totalSpent) : "—"}</td>
                      <td className="text-xs text-muted-foreground whitespace-nowrap">{relDay(c.lastSeenAt)}</td>
                      <td>{c.marketingOptIn ? <BellRing className="w-4 h-4 text-primary" aria-label="موافق" /> : <span className="text-muted-foreground/50">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {rows.length >= 200 && <p className="text-xs text-muted-foreground text-center">تُعرض أول 200 — استخدم البحث للوصول لزبون محدد، أو صدّر القائمة كاملة.</p>}

      <CustomerDrawer phone={open} onClose={() => setOpen(null)} owner={owner} money={money} />
    </div>
  );
}

const intl = (p: string) => (p.startsWith("+") ? p : `+${p}`);

function relDay(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "اليوم";
  if (d === 1) return "أمس";
  if (d < 30) return `قبل ${d} يوم`;
  return shortDate(iso);
}

const T_STATUS: Record<string, string> = { done: "خُدم", serving: "قيد الخدمة", called: "نودي", waiting: "ينتظر", no_show: "لم يحضر", cancelled: "حُذف", left: "غادر" };
const O_STATUS: Record<string, string> = { pending: "لم تصل رسالته", received: "جديد", preparing: "قيد التحضير", ready: "جاهز", completed: "سُلّم", cancelled: "ملغي" };
const B_STATUS: Record<string, string> = { pending: "بانتظار التأكيد", confirmed: "مؤكد", arrived: "وصل", done: "انتهى", cancelled: "ملغي", no_show: "لم يحضر" };

function CustomerDrawer({ phone, onClose, owner, money }: { phone: string | null; onClose: () => void; owner: boolean; money: (v: number) => string }) {
  const shop = useShop();
  const qc = useQueryClient();
  const d = useQuery<Detail>({ queryKey: ["/api/customers", "one", phone], queryFn: () => get(`/api/customers/${encodeURIComponent(phone!)}`), enabled: !!phone });
  const items = useQuery<Array<{ id: number; name: string }>>({ queryKey: ["/api/menu/items"], queryFn: () => get("/api/menu/items"), enabled: !!phone, staleTime: 60_000 });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEditing(false); }, [phone]);

  const c = d.data?.customer;
  const favs = useMemo(() => {
    if (!c) return [];
    const names = new Map<number, string>();
    for (const i of items.data ?? []) names.set(i.id, i.name);
    for (const o of d.data?.orders ?? []) for (const l of o.items ?? []) names.set(l.itemId, l.name);
    return Object.entries(c.favourites ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, k]) => ({ name: names.get(Number(id)) ?? `صنف #${id}`, k }));
  }, [c, items.data, d.data]);

  const timeline = useMemo(() => {
    if (!d.data) return [];
    const ev: Array<{ at: string; icon: typeof ShoppingBag; text: string; sub?: string; tone?: string }> = [];
    for (const t of d.data.tickets) ev.push({ at: t.joinedAt, icon: ListOrdered, text: `الصف · ${t.displayCode}`, sub: T_STATUS[t.status] ?? t.status, tone: t.status === "no_show" ? "text-amber-400" : undefined });
    for (const o of d.data.orders) ev.push({ at: o.createdAt, icon: ShoppingBag, text: `طلب #${o.code} · ${money(o.subtotal)}`, sub: `${O_STATUS[o.status] ?? o.status} · ${(o.items ?? []).map((l) => `${l.qty}× ${l.name}`).join("، ")}` });
    for (const b of d.data.bookings) ev.push({ at: b.startsAt, icon: CalendarDays, text: `حجز #${b.code} · ${b.partySize} أشخاص`, sub: B_STATUS[b.status] ?? b.status, tone: b.status === "no_show" ? "text-amber-400" : undefined });
    return ev.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 60);
  }, [d.data, money]);

  const save = async (body: Record<string, unknown>, ok: string) => {
    if (!phone) return;
    setSaving(true);
    try {
      await patch(`/api/customers/${encodeURIComponent(phone)}`, body);
      toast.success(ok);
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["/api/customers"] });
    } catch (e) { toast.error(errText(e)); }
    finally { setSaving(false); }
  };

  return (
    <Drawer open={!!phone} onOpenChange={(v) => !v && onClose()} title={c?.name || phone || ""}>
      {d.isLoading || !c ? <div className="py-16 grid place-items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
                  <button className="w-10 h-10 rounded-lg bg-primary text-primary-foreground grid place-items-center shrink-0 disabled:opacity-50" disabled={saving} onClick={() => save({ name }, "حُفظ الاسم")} aria-label="حفظ"><Check className="w-4 h-4" /></button>
                  <button className="w-10 h-10 rounded-lg bg-secondary grid place-items-center shrink-0" onClick={() => setEditing(false)} aria-label="إلغاء"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="text-xl font-bold truncate">{c.name || "بدون اسم"}</div>
                  {owner && <button onClick={() => { setName(c.name ?? ""); setEditing(true); }} className="text-muted-foreground hover:text-foreground" aria-label="تعديل الاسم"><Pencil className="w-4 h-4" /></button>}
                </div>
              )}
              <a href={`https://wa.me/${c.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground tabular-nums hover:text-primary" dir="ltr">{intl(c.phone)}</a>
              <div className="text-xs text-muted-foreground mt-1">أول مرة {shortDate(c.firstSeenAt, shop.org.timezone)} · آخر مرة {relDay(c.lastSeenAt)}</div>
            </div>
            {c.ratingLast ? (
              <div className="text-center shrink-0">
                <div className="flex gap-0.5">{[1, 2, 3, 4, 5].map((k) => <Star key={k} className={cn("w-4 h-4", k <= c.ratingLast! ? "fill-primary text-primary" : "text-muted-foreground/40")} />)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">آخر تقييم</div>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="زيارات" value={c.visits} />
            <Stat label="طلبات" value={c.ordersCount} />
            <Stat label="حجوزات" value={c.bookingsCount} />
            <Stat label="لم يحضر" value={c.noShows} tone={c.noShows ? "warn" : undefined} />
            <Stat label="الإنفاق" value={c.totalSpent ? money(c.totalSpent) : "—"} className="col-span-2" tone="gold" />
          </div>

          <div className="rounded-xl border border-card-border bg-card p-3 flex items-center gap-3">
            <Megaphone className={cn("w-5 h-5 shrink-0", c.marketingOptIn ? "text-primary" : "text-muted-foreground")} />
            <div className="flex-1 text-sm">
              {c.marketingOptIn
                ? <>وافق على استلام العروض{c.optInAt ? ` · ${shortDate(c.optInAt, shop.org.timezone)}` : ""}</>
                : <span className="text-muted-foreground">لم يوافق على العروض — لا تصله حملات، فقط إشعارات دوره وطلبه.</span>}
            </div>
            {owner && c.marketingOptIn && (
              <Btn tone="danger" className="min-h-9 text-xs" disabled={saving}
                onClick={() => { if (confirm("سحب موافقة هذا الزبون على العروض؟ لن تصله أي حملة بعد الآن. لا يمكن إعادتها إلا من الزبون نفسه.")) void save({ marketingOptIn: false }, "سُحبت الموافقة"); }}>
                سحب الموافقة
              </Btn>
            )}
          </div>

          {favs.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2">يطلب عادةً</div>
              <div className="flex flex-wrap gap-1.5">
                {favs.map((f) => <span key={f.name} className="text-sm rounded-full bg-secondary px-3 py-1">{f.name} <span className="text-muted-foreground tabular-nums">×{f.k}</span></span>)}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-semibold mb-2">السجل</div>
            {timeline.length === 0 ? <div className="text-sm text-muted-foreground">لا شيء بعد.</div> : (
              <ol className="space-y-2.5 border-s border-border ms-2">
                {timeline.map((e, i) => (
                  <li key={i} className="ps-4 relative">
                    <span className="absolute -start-[9px] top-0.5 w-[18px] h-[18px] rounded-full bg-popover border border-border grid place-items-center"><e.icon className="w-2.5 h-2.5 text-primary" /></span>
                    <div className="text-sm">{e.text}</div>
                    <div className={cn("text-xs text-muted-foreground", e.tone)}>{e.sub} · {shortDate(e.at, shop.org.timezone)} {clock(e.at, shop.org.timezone)}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {c.noShows >= 2 && <div className="text-xs text-amber-300 flex items-center gap-1.5"><UserX className="w-3.5 h-3.5" />تغيّب {c.noShows} مرات — قد تفضّل تأكيد حضوره قبل النداء.</div>}
          {c.visits + c.ordersCount >= 2 && <div className="text-xs text-primary flex items-center gap-1.5"><Repeat className="w-3.5 h-3.5" />زبون دائم</div>}
        </div>
      )}
    </Drawer>
  );
}

