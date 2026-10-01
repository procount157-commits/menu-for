// ── One menu item, in full ────────────────────────────────────────
// Names and text in both languages, price, photos, tags, options, and this
// branch's own availability and price. The item itself saves in one PATCH;
// the branch part saves through /availability because it is per branch.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, ChevronDown, ChevronUp, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import type { OptionGroup } from "@workspace/menu-shared";
import { cn } from "@/lib/utils";
import { patch, post, useShop, inputCls } from "@/lib/shop-api";
import { Field, ImageDrop, Modal, Toggle, ToggleRow, UpgradeNotice, btnGhost, btnPrimary, btnQuiet, iconBtn, isPlanError, type StoredImage } from "./kit";

export interface MenuItem {
  id: number; categoryId: number | null; kind: "product" | "service"; name: string; nameEn: string | null;
  description: string | null; descriptionEn: string | null; price: number; compareAtPrice: number | null; durationMin: number | null;
  images: StoredImage[]; options: OptionGroup[]; tags: string[]; calories: number | null; allergens: string[];
  sort: number; isActive: boolean; branch: { available: boolean; price: number | null };
}
export interface Category { id: number; name: string; nameEn: string | null; imageUrl: string | null; sort: number; isActive: boolean }

export const ITEMS_KEY = ["/api/menu/items"];
export const CATS_KEY = ["/api/menu/categories"];

export const TAGS: Array<[string, string]> = [
  ["new", "جديد"], ["popular", "الأكثر طلباً"], ["offer", "عرض"], ["chef", "اختيار الشيف"], ["spicy", "حار"],
  ["vegetarian", "نباتي"], ["vegan", "نباتي صرف"], ["gluten_free", "بدون جلوتين"], ["preorder", "طلب مسبق"],
];
const ALLERGENS = ["قمح", "حليب", "بيض", "مكسرات", "فول سوداني", "سمسم", "صويا", "سمك", "قشريات"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const mediaUrl = (u?: string | null) => (u && u.startsWith("/") ? `${BASE}${u}` : u ?? null);

type Draft = Omit<MenuItem, "id" | "branch" | "sort" | "price" | "compareAtPrice" | "calories" | "durationMin"> & {
  id?: number; price: string; compareAtPrice: string; calories: string; durationMin: string;
};

const toDraft = (i: MenuItem): Draft => ({
  ...i, price: String(i.price ?? ""), compareAtPrice: i.compareAtPrice == null ? "" : String(i.compareAtPrice),
  calories: i.calories == null ? "" : String(i.calories), durationMin: i.durationMin == null ? "" : String(i.durationMin),
  images: i.images ?? [], options: i.options ?? [], tags: i.tags ?? [], allergens: i.allergens ?? [],
});

export function blankItem(categoryId: number | null, service: boolean): MenuItem {
  return {
    id: 0, categoryId, kind: service ? "service" : "product", name: "", nameEn: null, description: null, descriptionEn: null,
    price: 0, compareAtPrice: null, durationMin: service ? 30 : null, images: [], options: [], tags: [], calories: null, allergens: [],
    sort: 0, isActive: true, branch: { available: true, price: null },
  };
}

export default function ItemEditor({ item, categories, onClose }: { item: MenuItem; categories: Category[]; onClose: () => void }) {
  const shop = useShop();
  const qc = useQueryClient();
  const isNew = !item.id;
  const [d, setD] = useState<Draft>(() => ({ ...toDraft(item), price: isNew ? "" : String(item.price) }));
  const [branchAvail, setBranchAvail] = useState(item.branch.available);
  const [branchPrice, setBranchPrice] = useState(item.branch.price == null ? "" : String(item.branch.price));
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [more, setMore] = useState(!isNew && (item.options.length > 0 || item.allergens.length > 0 || item.calories != null));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const word = shop.vocab.item[0];
  const multiBranch = shop.branches.length > 1;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: d.name, nameEn: d.nameEn ?? "", description: d.description ?? "", descriptionEn: d.descriptionEn ?? "",
        price: d.price, compareAtPrice: d.compareAtPrice === "" ? null : d.compareAtPrice, categoryId: d.categoryId,
        kind: d.kind, durationMin: d.kind === "service" ? (d.durationMin || null) : null, calories: d.calories || null,
        tags: d.tags, allergens: d.allergens, images: d.images, options: d.options, isActive: d.isActive,
      };
      const saved = isNew ? await post<MenuItem>("/api/menu/items", body) : await patch<MenuItem>(`/api/menu/items/${item.id}`, body);
      // The branch's own part, only when it changed.
      const origPrice = item.branch.price == null ? "" : String(item.branch.price);
      if (!isNew && (branchAvail !== item.branch.available || branchPrice !== origPrice)) {
        await patch("/api/menu/availability", { itemId: saved.id, available: branchAvail, price: branchPrice === "" ? null : branchPrice });
      }
      return saved;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ITEMS_KEY }); toast.success(isNew ? `انضاف ${d.name}` : "انحفظ"); onClose(); },
    onError: (e) => { if (isPlanError(e)) setUpgrade(e.message); else toast.error((e as Error).message); },
  });

  const priceOk = d.price !== "" && Number(d.price) >= 0;
  const canSave = d.name.trim().length > 0 && priceOk && !save.isPending;

  return (
    <Modal open onClose={onClose} wide title={isNew ? `${word} جديد` : `تعديل ${item.name}`}
      footer={<>
        <button className={btnQuiet} onClick={onClose}>إلغاء</button>
        <button className={btnPrimary} disabled={!canSave} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}{isNew ? "أضف" : "احفظ"}</button>
      </>}>
      <div className="space-y-6">
        {upgrade && <UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} />}

        {/* photos */}
        <div>
          <div className="text-sm text-muted-foreground mb-2">الصور <span className="text-muted-foreground/60">— الأولى هي اللي تطلع في القائمة · حتى 6</span></div>
          <div className="flex flex-wrap gap-2">
            {d.images.map((img, i) => (
              <div key={img.url} className="relative w-24 h-24 rounded-xl overflow-hidden border border-card-border group">
                <img src={mediaUrl(img.sm ?? img.url)!} alt="" className="w-full h-full object-cover" />
                {i === 0 && <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground">الرئيسية</span>}
                <div className="absolute inset-x-0 top-0 flex justify-between p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" className="w-6 h-6 rounded-full bg-background/80 flex items-center justify-center" aria-label="إزالة"
                    onClick={() => set("images", d.images.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></button>
                  {i > 0 && <button type="button" className="w-6 h-6 rounded-full bg-background/80 flex items-center justify-center" aria-label="اجعلها الرئيسية" title="اجعلها الرئيسية"
                    onClick={() => set("images", [img, ...d.images.filter((_, j) => j !== i)])}><Star className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
            {d.images.length < 6 && <ImageDrop value={null} className="w-24 h-24" label="أضف صورة" onChange={(img) => img && setD((p) => ({ ...p, images: [...p.images, img].slice(0, 6) }))} />}
          </div>
        </div>

        {/* names */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="الاسم"><input autoFocus={isNew} className={inputCls} value={d.name} onChange={(e) => set("name", e.target.value)} placeholder={shop.vocab.services ? "قص وسشوار" : "شاورما دجاج"} /></Field>
          <Field label="بالإنجليزي"><input className={inputCls} dir="ltr" value={d.nameEn ?? ""} onChange={(e) => set("nameEn", e.target.value)} placeholder={shop.vocab.services ? "Cut & blow-dry" : "Chicken shawarma"} /></Field>
          <Field label="الوصف"><textarea className={cn(inputCls, "min-h-[72px]")} value={d.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="وش فيه، يكفي كم، وش يميّزه" /></Field>
          <Field label="بالإنجليزي"><textarea className={cn(inputCls, "min-h-[72px]")} dir="ltr" value={d.descriptionEn ?? ""} onChange={(e) => set("descriptionEn", e.target.value)} /></Field>
        </div>

        {/* price, category, kind */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label={`السعر (${shop.org.currency})`}><input type="number" min={0} step="0.5" inputMode="decimal" className={cn(inputCls, "tabular-nums")} value={d.price} onChange={(e) => set("price", e.target.value)} /></Field>
          <Field label="السعر قبل الخصم" hint="يطلع مشطوب"><input type="number" min={0} step="0.5" inputMode="decimal" className={cn(inputCls, "tabular-nums")} value={d.compareAtPrice} onChange={(e) => set("compareAtPrice", e.target.value)} /></Field>
          <Field label="التصنيف" className="col-span-2">
            <select className={inputCls} value={d.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value ? Number(e.target.value) : null)}>
              <option value="">بدون تصنيف</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1.5">النوع</div>
            <div className="inline-flex rounded-lg border border-card-border p-0.5">
              {([["product", "منتج / طبق"], ["service", "خدمة لها مدة"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => set("kind", k)} className={cn("px-3 py-1.5 rounded-md text-sm", d.kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{l}</button>
              ))}
            </div>
          </div>
          {d.kind === "service" && (
            <Field label="المدة (دقيقة)" className="w-32"><input type="number" min={5} max={600} step={5} className={inputCls} value={d.durationMin} onChange={(e) => set("durationMin", e.target.value)} /></Field>
          )}
        </div>

        {/* tags */}
        <div>
          <div className="text-sm text-muted-foreground mb-2">علامات</div>
          <div className="flex flex-wrap gap-2">
            {TAGS.map(([k, l]) => {
              const on = d.tags.includes(k);
              return (
                <button key={k} type="button" onClick={() => set("tags", on ? d.tags.filter((t) => t !== k) : [...d.tags, k])}
                  className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", on ? "border-primary bg-primary/15 text-primary" : "border-card-border text-muted-foreground hover:text-foreground")}>{l}</button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-card-border px-4">
          <ToggleRow title="ظاهر في المنيو" hint="إخفاؤه يشيله من كل الفروع. لو بس خلص اليوم، استخدم «متوفر» تحت." checked={d.isActive} onChange={(v) => set("isActive", v)} />
          {!isNew && (
            <>
              <div className="border-t border-border" />
              <ToggleRow title={multiBranch ? `متوفر في ${shop.branch.name}` : "متوفر الحين"} hint="«خلص» — يطلع للزبون بس ما يقدر يطلبه." checked={branchAvail} onChange={setBranchAvail} />
              {multiBranch && (
                <div className="flex items-center justify-between gap-4 py-3 border-t border-border">
                  <div>
                    <div className="text-sm font-medium">سعر خاص لهذا الفرع</div>
                    <div className="text-xs text-muted-foreground mt-0.5">فاضي = نفس السعر الأساسي ({d.price || "—"})</div>
                  </div>
                  <input type="number" min={0} step="0.5" className={cn(inputCls, "w-28 tabular-nums")} value={branchPrice} onChange={(e) => setBranchPrice(e.target.value)} />
                </div>
              )}
            </>
          )}
        </div>

        {/* more */}
        <button type="button" className="flex items-center gap-1.5 text-sm text-primary" onClick={() => setMore(!more)}>
          {more ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          الخيارات والإضافات، السعرات، مسببات الحساسية
        </button>
        {more && (
          <div className="space-y-6">
            <OptionsEditor value={d.options} onChange={(v) => set("options", v)} currency={shop.org.currency} />
            <div className="grid sm:grid-cols-[140px_1fr] gap-4">
              <Field label="السعرات"><input type="number" min={0} className={inputCls} value={d.calories} onChange={(e) => set("calories", e.target.value)} placeholder="kcal" /></Field>
              <div>
                <div className="text-sm text-muted-foreground mb-1.5">يحتوي على</div>
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...ALLERGENS, ...d.allergens])].map((a) => {
                    const on = d.allergens.includes(a);
                    return (
                      <button key={a} type="button" onClick={() => set("allergens", on ? d.allergens.filter((x) => x !== a) : [...d.allergens, a])}
                        className={cn("px-3 py-1.5 rounded-full text-xs border", on ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : "border-card-border text-muted-foreground")}>{a}</button>
                    );
                  })}
                  <input className={cn(inputCls, "w-28 py-1 text-xs")} placeholder="+ غيرها" onKeyDown={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (e.key === "Enter" && v) { e.preventDefault(); if (!d.allergens.includes(v)) set("allergens", [...d.allergens, v]); (e.target as HTMLInputElement).value = ""; }
                  }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Option groups: «الحجم», «الإضافات» ────────────────────────────

function OptionsEditor({ value, onChange, currency }: { value: OptionGroup[]; onChange: (v: OptionGroup[]) => void; currency: string }) {
  const up = (i: number, g: Partial<OptionGroup>) => onChange(value.map((x, j) => (j === i ? { ...x, ...g } : x)));
  const move = (i: number, by: number) => { const v = [...value]; const [g] = v.splice(i, 1); v.splice(i + by, 0, g!); onChange(v); };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">الخيارات والإضافات</div>
          <div className="text-xs text-muted-foreground mt-0.5">مثل «الحجم» (إجباري، واحد) أو «إضافات» (اختياري، أكثر من واحد).</div>
        </div>
        <button type="button" className={cn(btnGhost, "text-xs")} onClick={() => onChange([...value, { name: "", required: false, min: 0, max: 1, choices: [{ name: "", priceDelta: 0 }] }])}>
          <Plus className="w-3.5 h-3.5" />مجموعة
        </button>
      </div>
      {value.map((g, i) => (
        <div key={i} className="rounded-xl border border-card-border bg-muted/20 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className={cn(inputCls, "flex-1 min-w-[140px]")} value={g.name} placeholder="اسم المجموعة — مثلاً: الحجم" onChange={(e) => up(i, { name: e.target.value })} />
            <input className={cn(inputCls, "w-36")} dir="ltr" value={g.nameEn ?? ""} placeholder="Size" onChange={(e) => up(i, { nameEn: e.target.value })} />
            <div className="flex items-center">
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="لفوق"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" className={iconBtn} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="حذف المجموعة"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Toggle checked={g.required} onChange={(required) => up(i, { required, min: required ? Math.max(1, g.min) : 0 })} label="إجباري" />إجباري
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">أقل
              <input type="number" min={0} className={cn(inputCls, "w-16 py-1")} value={g.min} onChange={(e) => up(i, { min: Number(e.target.value) })} />
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">أكثر
              <input type="number" min={1} className={cn(inputCls, "w-16 py-1")} value={g.max} onChange={(e) => up(i, { max: Number(e.target.value) })} />
            </label>
            <span className="text-xs text-muted-foreground">{g.max <= 1 ? "يختار واحد" : `يختار حتى ${g.max}`}</span>
          </div>
          <div className="space-y-2">
            {g.choices.map((c, ci) => (
              <div key={ci} className="flex items-center gap-2">
                <input className={cn(inputCls, "flex-1 min-w-0")} value={c.name} placeholder="الخيار — مثلاً: كبير" onChange={(e) => up(i, { choices: g.choices.map((x, j) => (j === ci ? { ...x, name: e.target.value } : x)) })} />
                <input className={cn(inputCls, "w-28 hidden sm:block")} dir="ltr" value={c.nameEn ?? ""} placeholder="Large" onChange={(e) => up(i, { choices: g.choices.map((x, j) => (j === ci ? { ...x, nameEn: e.target.value } : x)) })} />
                <div className="relative w-24 shrink-0">
                  <input type="number" step="0.5" dir="ltr" className={cn(inputCls, "tabular-nums pl-10")} value={c.priceDelta} onChange={(e) => up(i, { choices: g.choices.map((x, j) => (j === ci ? { ...x, priceDelta: Number(e.target.value) } : x)) })} />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">+{currency}</span>
                </div>
                <button type="button" className={iconBtn} onClick={() => up(i, { choices: g.choices.filter((_, j) => j !== ci) })} aria-label="حذف الخيار"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button type="button" className="text-xs text-primary flex items-center gap-1" onClick={() => up(i, { choices: [...g.choices, { name: "", priceDelta: 0 }] })}><Plus className="w-3 h-3" />خيار</button>
          </div>
        </div>
      ))}
    </div>
  );
}
