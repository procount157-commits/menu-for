// ── First run: from sign-up to a working menu link ────────────────
// ShopGate shows this to an owner with no shop. Five short steps, each one
// thing; the shop is only created at «تم», so going back costs nothing.
// The logo waits in the browser until then because image uploads belong to
// an org and there is none yet.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Cake, Check, CheckCircle2, Coffee, ImagePlus, Loader2, LogOut, QrCode, Scissors,
  Sparkles, UtensilsCrossed, X,
} from "lucide-react";
import { TEMPLATES, VOCAB, slugError, type Template, type Vertical } from "@workspace/menu-shared";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { SHOP_KEY, get, patch, post, upload, inputCls } from "@/lib/shop-api";
import { CopyButton, btnGhost, btnPrimary, btnQuiet, type StoredImage } from "@/components/shop/setup/kit";

const VERTICALS: Array<{ id: Vertical; icon: typeof Coffee; title: string; sub: string }> = [
  { id: "restaurant", icon: UtensilsCrossed, title: "مطعم", sub: "أطباق، طاولات، قائمة انتظار" },
  { id: "cafe", icon: Coffee, title: "كافيه", sub: "مشروبات، دور الطلبات" },
  { id: "sweets", icon: Cake, title: "حلويات", sub: "صواني وكيك، طلب مسبق بتاريخ" },
  { id: "beauty", icon: Sparkles, title: "صالون تجميل", sub: "خدمات لها مدة، مواعيد، الدور" },
  { id: "barber", icon: Scissors, title: "حلاقة رجالي", sub: "دور لكل كرسي باسم الحلاق، مواعيد" },
];

const BRAND_SWATCHES = ["#22c55e", "#c9a24a", "#b5651d", "#7c5a3a", "#c2577a", "#8e3b46", "#2f6f5e", "#3b5b8e", "#111111"];

const STEPS = ["الاسم", "النشاط", "الرابط", "الهوية", "تم"] as const;

/** Keep what the owner types to what a slug may hold, as they type it. */
const cleanSlug = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").slice(0, 40);

type SlugState = { state: "idle" | "checking" | "ok" | "bad"; msg?: string | null };

export default function Onboarding() {
  const qc = useQueryClient();
  const [, go] = useLocation();
  const { logout } = useAuth();

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [tagline, setTagline] = useState("");
  const [vertical, setVertical] = useState<Vertical | null>(null);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugCheck, setSlugCheck] = useState<SlugState>({ state: "idle" });
  const [template, setTemplate] = useState<Template>("noir");
  const [brand, setBrand] = useState("#22c55e");
  const [logo, setLogo] = useState<File | null>(null);
  const [address, setAddress] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ menuUrl: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const logoPreview = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);

  // Picking a kind of shop brings its look along, until the owner picks their own.
  const lookTouched = useRef(false);
  useEffect(() => {
    if (!vertical || lookTouched.current) return;
    setTemplate(VOCAB[vertical].template);
    setBrand(VOCAB[vertical].brand);
  }, [vertical]);

  // Suggest an address from the name the first time the owner reaches it.
  useEffect(() => {
    if (step !== 2 || slugTouched || slug) return;
    get<{ suggestion: string }>(`/api/onboarding/slug?name=${encodeURIComponent(name)}&nameEn=${encodeURIComponent(nameEn)}`)
      .then((r) => { if (r.suggestion) setSlug(r.suggestion); }).catch(() => {});
  }, [step, slugTouched, slug, name, nameEn]);

  // Live availability, debounced; the local rules answer first without a round trip.
  useEffect(() => {
    if (!slug) { setSlugCheck({ state: "idle" }); return; }
    const local = slugError(slug);
    if (local) { setSlugCheck({ state: "bad", msg: local }); return; }
    setSlugCheck({ state: "checking" });
    const h = setTimeout(() => {
      get<{ ok: boolean; error?: string | null }>(`/api/onboarding/slug?s=${encodeURIComponent(slug)}`)
        .then((r) => setSlugCheck(r.ok ? { state: "ok" } : { state: "bad", msg: r.error ?? "غير متاح" }))
        .catch(() => setSlugCheck({ state: "idle" }));
    }, 350);
    return () => clearTimeout(h);
  }, [slug]);

  const canNext = [
    name.trim().length >= 2,
    !!vertical,
    slugCheck.state === "ok",
    true,
  ][step] ?? false;

  const move = (to: number) => { setDir(to > step ? 1 : -1); setStep(to); };

  const create = async () => {
    setBusy(true);
    try {
      const r = await post<{ menuUrl: string }>("/api/onboarding/org", {
        name: name.trim(), nameEn: nameEn.trim() || undefined, vertical, slug, tagline: tagline.trim() || undefined,
        template, brand, address: address.trim() || undefined, displayPhone: displayPhone.trim() || undefined,
      });
      if (logo) {
        try {
          const img = await upload<StoredImage>("/api/menu/images?kind=logo", logo);
          await patch("/api/org", { logoUrl: img.md ?? img.url });
        } catch (e) {
          // The shop exists; a failed logo is fixed later from the settings page.
          toast.error(`ما انرفع الشعار: ${(e as Error).message} — تقدر ترفعه من الإعدادات`);
        }
      }
      await post("/api/onboarding/done").catch(() => {});
      setCreated({ menuUrl: r.menuUrl });
      setDir(1); setStep(4);
    } catch (e) {
      toast.error((e as Error).message);
      if (/رابط/.test((e as Error).message)) move(2);
    } finally { setBusy(false); }
  };

  /** Leave the wizard: the shop query now finds the org and ShopGate lets the app through. */
  const finish = async (to: string) => {
    go(to);
    await qc.invalidateQueries({ queryKey: SHOP_KEY });
  };

  const tpl = TEMPLATES[template];
  const v = vertical ? VOCAB[vertical] : VOCAB.restaurant;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" dir="rtl">
      <header className="flex items-center justify-between px-4 sm:px-8 py-4">
        <div className="flex items-center gap-2 font-semibold"><Sparkles className="w-4 h-4 text-primary" />منيو فور يو</div>
        {!created && <button className={cn(btnQuiet, "text-xs")} onClick={() => logout()}><LogOut className="w-3.5 h-3.5" />خروج</button>}
      </header>

      <div className="w-full max-w-xl mx-auto px-4 sm:px-6 flex-1 flex flex-col pb-8">
        {/* progress */}
        <div className="flex items-center gap-1.5 mb-8 mt-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-muted")} />
              <div className={cn("text-[11px] mt-1.5 hidden sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{s}</div>
            </div>
          ))}
        </div>

        <div className="relative flex-1">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step} custom={dir}
              initial={{ opacity: 0, x: dir * -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * 24 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {step === 0 && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">أهلاً فيك</h1>
                    <p className="text-muted-foreground mt-2">خمس دقايق وتطلع بمنيو رقمي، صف انتظار، وكود QR جاهز للطباعة. نبدأ باسم المحل.</p>
                  </div>
                  <label className="block">
                    <span className="block text-sm text-muted-foreground mb-1.5">اسم المحل</span>
                    <input autoFocus className={cn(inputCls, "text-lg py-3")} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: بيت الشامي" maxLength={160}
                      onKeyDown={(e) => e.key === "Enter" && canNext && move(1)} />
                  </label>
                  <label className="block">
                    <span className="block text-sm text-muted-foreground mb-1.5">الاسم بالإنجليزي <span className="text-muted-foreground/60">(اختياري — للزبون اللي يقرأ إنجليزي)</span></span>
                    <input className={inputCls} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Bait Al Shami" maxLength={160} />
                  </label>
                  <label className="block">
                    <span className="block text-sm text-muted-foreground mb-1.5">سطر تعريفي <span className="text-muted-foreground/60">(اختياري)</span></span>
                    <input className={inputCls} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="مشاوي شامية على الفحم من 1998" maxLength={200} />
                  </label>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold">وش نوع المحل؟</h1>
                    <p className="text-muted-foreground mt-2">نرتب لك الكلمات والقالب على حسبه — تقدر تغيّره بعدين.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {VERTICALS.map((x) => {
                      const on = vertical === x.id;
                      return (
                        <button key={x.id} type="button" onClick={() => setVertical(x.id)}
                          className={cn("relative text-start rounded-2xl border p-4 sm:p-5 transition-all min-h-[140px] flex flex-col",
                            on ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary))]" : "border-card-border bg-card hover:border-primary/40")}>
                          <x.icon className={cn("w-7 h-7 mb-auto", on ? "text-primary" : "text-muted-foreground")} />
                          <div className="font-semibold mt-4">{x.title}</div>
                          <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{x.sub}</div>
                          {on && <span className="absolute top-3 left-3 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Check className="w-3 h-3" /></span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold">رابط المحل</h1>
                    <p className="text-muted-foreground mt-2">هذا اللي ينطبع على الـ QR ويرسله الزبون لربعه. قصير وسهل ينقال أحسن.</p>
                  </div>
                  <div>
                    <div className={cn("flex items-stretch rounded-xl border bg-input overflow-hidden focus-within:ring-2 focus-within:ring-ring",
                      slugCheck.state === "bad" ? "border-destructive/60" : slugCheck.state === "ok" ? "border-emerald-500/50" : "border-border")} dir="ltr">
                      <span className="px-3 flex items-center text-sm text-muted-foreground bg-muted/50 border-e border-border select-none">{location.host}/</span>
                      <input autoFocus className="flex-1 min-w-0 bg-transparent px-3 py-3 text-lg font-mono focus:outline-none" value={slug}
                        onChange={(e) => { setSlugTouched(true); setSlug(cleanSlug(e.target.value)); }}
                        onKeyDown={(e) => e.key === "Enter" && canNext && move(3)} placeholder="bait-shami" />
                      <span className="px-3 flex items-center">
                        {slugCheck.state === "checking" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                        {slugCheck.state === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                        {slugCheck.state === "bad" && <X className="w-4 h-4 text-destructive" />}
                      </span>
                    </div>
                    <div className={cn("text-xs mt-2 min-h-[1rem]", slugCheck.state === "bad" ? "text-destructive" : "text-emerald-400")}>
                      {slugCheck.state === "ok" ? "متاح — هذا رابطك" : slugCheck.state === "bad" ? slugCheck.msg : ""}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">أحرف إنجليزية صغيرة وأرقام وشرطة. انتبه: لو غيّرته بعد ما تطبع الـ QR، المطبوع يتعطل.</p>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold">شكل المنيو</h1>
                    <p className="text-muted-foreground mt-2">الشعار والقالب واللون — هذا اللي يشوفه الزبون أول ما يمسح.</p>
                  </div>

                  <div className="flex items-center gap-4">
                    <button type="button" onClick={() => logoInput.current?.click()}
                      className="relative w-20 h-20 rounded-2xl border border-dashed border-card-border bg-muted/40 overflow-hidden flex items-center justify-center hover:border-primary/60 shrink-0">
                      {logoPreview ? <img src={logoPreview} alt="" className="w-full h-full object-cover" /> : <ImagePlus className="w-6 h-6 text-muted-foreground" />}
                    </button>
                    <div className="text-sm">
                      <div className="font-medium">الشعار</div>
                      <div className="text-xs text-muted-foreground mt-0.5">مربّع، PNG أو JPG. تقدر تتخطاه الحين.</div>
                      {logo && <button className="text-xs text-destructive mt-1" onClick={() => setLogo(null)}>إزالة</button>}
                    </div>
                    <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setLogo(f); e.target.value = ""; }} />
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-2">القالب</div>
                    <div className="grid grid-cols-4 gap-2">
                      {(Object.keys(TEMPLATES) as Template[]).map((k) => {
                        const t = TEMPLATES[k];
                        return (
                          <button key={k} type="button" onClick={() => { lookTouched.current = true; setTemplate(k); }}
                            className={cn("rounded-xl border p-1.5 transition-all", template === k ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary))]" : "border-card-border hover:border-primary/40")}>
                            <div className="h-12 rounded-lg flex flex-col justify-end p-1.5 gap-1" style={{ background: t.bg }}>
                              <div className="h-1.5 w-3/4 rounded-full" style={{ background: t.text, opacity: 0.8 }} />
                              <div className="h-3 rounded" style={{ background: t.surface, border: `1px solid ${t.muted}33` }} />
                            </div>
                            <div className="text-[11px] mt-1.5 text-center">{t.label[0]}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground mb-2">لون الهوية</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {BRAND_SWATCHES.map((c) => (
                        <button key={c} type="button" onClick={() => { lookTouched.current = true; setBrand(c); }} aria-label={c}
                          className={cn("w-8 h-8 rounded-full border-2 transition-transform", brand.toLowerCase() === c ? "border-foreground scale-110" : "border-transparent ring-1 ring-white/15")} style={{ background: c }} />
                      ))}
                      <label className="relative w-8 h-8 rounded-full border border-dashed border-muted-foreground/50 overflow-hidden cursor-pointer" title="لون آخر"
                        style={{ background: BRAND_SWATCHES.includes(brand.toLowerCase()) ? undefined : brand }}>
                        <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={brand} onChange={(e) => { lookTouched.current = true; setBrand(e.target.value); }} />
                        {BRAND_SWATCHES.includes(brand.toLowerCase()) && <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">+</span>}
                      </label>
                    </div>
                  </div>

                  {/* What the customer will see, roughly */}
                  <div className="rounded-2xl overflow-hidden border border-card-border" style={{ background: tpl.bg, color: tpl.text }}>
                    <div className="p-4 flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center font-bold shrink-0" style={{ background: brand, color: "#fff" }}>
                        {logoPreview ? <img src={logoPreview} alt="" className="w-full h-full object-cover" /> : (name.trim()[0] ?? "م")}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold truncate">{name || "اسم المحل"}</div>
                        <div className="text-xs truncate" style={{ color: tpl.muted }}>{tagline || v.label[0]}</div>
                      </div>
                    </div>
                    <div className="px-4 pb-4 space-y-2">
                      {v.defaultCategories.slice(0, 2).map(([c], i) => (
                        <div key={c} className="rounded-xl p-3 flex items-center justify-between" style={{ background: tpl.surface, border: `1px solid ${tpl.muted}22` }}>
                          <div>
                            <div className="text-sm font-medium">{c}</div>
                            <div className="text-[11px]" style={{ color: tpl.muted }}>{v.item[0]} {i + 1}</div>
                          </div>
                          <span className="text-sm font-semibold" style={{ color: brand }}>{i ? "28" : "45"} د.إ</span>
                        </div>
                      ))}
                      <div className="rounded-full py-2.5 text-center text-sm font-semibold mt-3" style={{ background: brand, color: "#fff" }}>احجز دورك · قدامك 3</div>
                    </div>
                  </div>

                  <details className="rounded-xl border border-card-border bg-card px-4 py-3 group">
                    <summary className="text-sm cursor-pointer text-muted-foreground list-none flex items-center justify-between">
                      معلومات للزبون <span className="text-xs">(اختياري)</span>
                    </summary>
                    <div className="space-y-3 mt-3">
                      <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان — مثلاً: العين، شارع خليفة" />
                      <input className={inputCls} dir="ltr" value={displayPhone} onChange={(e) => setDisplayPhone(e.target.value)} placeholder="+971 50 000 0000" />
                    </div>
                  </details>
                </div>
              )}

              {step === 4 && created && (
                <div className="space-y-6 text-center pt-4">
                  <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 16 }}
                    className="w-16 h-16 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto">
                    <Check className="w-8 h-8" />
                  </motion.div>
                  <div>
                    <h1 className="text-2xl font-bold">مبروك، {name} جاهز</h1>
                    <p className="text-muted-foreground mt-2">هذا رابط المنيو. باقي تضيف {v.items[0]} وتطبع الـ QR.</p>
                  </div>
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center justify-center gap-2">
                    <span className="font-mono text-primary text-sm" dir="ltr">{created.menuUrl.replace(/^https?:\/\//, "")}</span>
                    <CopyButton text={created.menuUrl} />
                  </div>
                  <div className="grid gap-2 text-start">
                    <button className={cn(btnPrimary, "justify-between py-3")} onClick={() => finish("/menu")}>
                      <span className="flex items-center gap-2"><UtensilsCrossed className="w-4 h-4" />أضف {v.items[0]}</span><ArrowLeft className="w-4 h-4" />
                    </button>
                    <button className={cn(btnGhost, "justify-between py-3")} onClick={() => finish("/qr")}>
                      <span className="flex items-center gap-2"><QrCode className="w-4 h-4" />اطبع الـ QR</span><ArrowLeft className="w-4 h-4" />
                    </button>
                    <button className={cn(btnQuiet, "py-3")} onClick={() => finish("/shop")}>روح للرئيسية</button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {step < 4 && (
          <div className="flex items-center justify-between gap-3 pt-8">
            {step > 0 ? (
              <button className={btnQuiet} onClick={() => move(step - 1)}><ArrowRight className="w-4 h-4" />رجوع</button>
            ) : <span />}
            {step < 3 ? (
              <button className={cn(btnPrimary, "px-6 py-2.5")} disabled={!canNext} onClick={() => move(step + 1)}>التالي<ArrowLeft className="w-4 h-4" /></button>
            ) : (
              <button className={cn(btnPrimary, "px-8 py-2.5")} disabled={busy} onClick={create}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}تم
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
