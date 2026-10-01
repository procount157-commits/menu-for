// ── /menu — the menu editor ───────────────────────────────────────
// Categories down the side, the chosen category's items beside them, both
// reordered by dragging a handle (framer-motion Reorder; the handle keeps a
// phone's scroll working). The availability switch on each row is this
// branch's «خلص / متوفر» and moves before the server answers. Managers use
// this page inside StaffLayout too, so it carries its own padding and never
// assumes the owner's sidebar.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "framer-motion";
import { toast } from "sonner";
import {
  Copy, ExternalLink, FolderPlus, GripVertical, Image as ImageIcon, Languages, Loader2, Megaphone, MoreHorizontal, Pencil, Plus,
  Search, Settings2, Trash2, Upload, UtensilsCrossed, X,
} from "lucide-react";
import { formatMoney } from "@workspace/menu-shared";
import { cn } from "@/lib/utils";
import { del, get, patch, post, useShop, inputCls } from "@/lib/shop-api";
import { Empty, Modal, PageHeader, SegTabs, Skel, Toggle, UpgradeNotice, btnGhost, btnPrimary, btnQuiet, iconBtn, isPlanError } from "@/components/shop/setup/kit";
import ItemEditor, { CATS_KEY, ITEMS_KEY, TAGS, blankItem, mediaUrl, type Category, type MenuItem } from "@/components/shop/setup/ItemEditor";
import OffersPanel from "@/components/shop/setup/OffersPanel";
import MenuImport from "@/components/shop/setup/MenuImport";

type Tab = "items" | "offers" | "import";
type Sel = number | "none";

const TAG_LABEL = Object.fromEntries(TAGS);

export default function MenuEditor() {
  const shop = useShop();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("items");
  const cats = useQuery<Category[]>({ queryKey: CATS_KEY, queryFn: () => get("/api/menu/categories") });
  const items = useQuery<MenuItem[]>({ queryKey: ITEMS_KEY, queryFn: () => get("/api/menu/items") });
  const [sel, setSel] = useState<Sel | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [manageCats, setManageCats] = useState(false);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const catList = cats.data ?? [];
  const all = items.data ?? [];
  const hasUncat = all.some((i) => !i.categoryId || !catList.some((c) => c.id === i.categoryId));

  // Land on the first category once they load, and recover if it is deleted.
  useEffect(() => {
    if (!cats.data) return;
    if (sel === null || (sel !== "none" && !cats.data.some((c) => c.id === sel))) setSel(cats.data[0]?.id ?? (hasUncat ? "none" : null));
  }, [cats.data, sel, hasUncat]);

  const counts = useMemo(() => {
    const m = new Map<Sel, number>();
    for (const i of all) {
      const k: Sel = i.categoryId && catList.some((c) => c.id === i.categoryId) ? i.categoryId : "none";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [all, catList]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (q) return all.filter((i) => i.name.toLowerCase().includes(q) || (i.nameEn ?? "").toLowerCase().includes(q));
    return all.filter((i) => (sel === "none" ? !i.categoryId || !catList.some((c) => c.id === i.categoryId) : i.categoryId === sel));
  }, [all, sel, q, catList]);

  const translate = async () => {
    setTranslating(true);
    try {
      const r = await post<{ translated: number; error: string | null }>("/api/menu/translate", { onlyMissing: true });
      if (r.error) toast.error(r.error);
      else toast.success(r.translated ? `ترجمنا ${r.translated} للإنجليزي` : "كل شي مترجم من قبل");
      qc.invalidateQueries({ queryKey: ITEMS_KEY }); qc.invalidateQueries({ queryKey: CATS_KEY });
    } catch (e) { toast.error((e as Error).message); }
    finally { setTranslating(false); }
  };

  const newItem = () => {
    const limit = shop.plan.limits.items;
    if (limit >= 0 && all.length >= limit) { setUpgrade(`باقتك تسمح بـ ${limit} ${shop.vocab.item[0]} — رقّها عشان تضيف أكثر.`); return; }
    setEditing(blankItem(typeof sel === "number" ? sel : null, shop.vocab.services));
  };

  const word = shop.vocab.items[0];
  // The staff guard lets a manager edit items but not run imports or translation (owner-only on the server).
  const canImport = shop.role === "owner" || shop.role === "manager";
  const loading = cats.isLoading || items.isLoading;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl" dir="rtl">
      <PageHeader
        icon={<UtensilsCrossed className="w-6 h-6 text-primary" />}
        title="المنيو"
        sub={<>{word}: <span className="tabular-nums">{all.length}</span> · التصنيفات: <span className="tabular-nums">{catList.length}</span> — أي تعديل يوصل للزبون على طول.</>}
        actions={<>
          {canImport && <button className={btnGhost} onClick={translate} disabled={translating}>{translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}<span className="hidden sm:inline">ترجم للإنجليزية</span></button>}
          <a href={shop.links.menu} target="_blank" rel="noreferrer" className={btnGhost}><ExternalLink className="w-4 h-4" />معاينة</a>
        </>}
      />

      <SegTabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "items", label: word, icon: <UtensilsCrossed className="w-3.5 h-3.5" /> },
        { id: "offers", label: "العروض", icon: <Megaphone className="w-3.5 h-3.5" /> },
        ...(canImport ? [{ id: "import" as const, label: "استيراد", icon: <Upload className="w-3.5 h-3.5" /> }] : []),
      ]} />

      {upgrade && <UpgradeNotice message={upgrade} onClose={() => setUpgrade(null)} />}

      {tab === "offers" && <OffersPanel items={all} />}
      {tab === "import" && canImport && <MenuImport />}

      {tab === "items" && (
        <div className="grid md:grid-cols-[230px_1fr] gap-5 items-start">
          {/* categories: a list on wide screens, chips on a phone */}
          <aside className="hidden md:block md:sticky md:top-4">
            <div className="bg-card border border-card-border rounded-2xl p-2">
              {cats.isLoading ? <div className="space-y-2 p-1">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-9" />)}</div> : (
                <CategoryList cats={catList} counts={counts} sel={q ? null : sel} onSelect={(s) => { setSearch(""); setSel(s); }} hasUncat={hasUncat} />
              )}
            </div>
          </aside>
          <div className="md:hidden -mx-4 px-4 overflow-x-auto">
            <div className="flex gap-2 pb-1">
              {catList.map((c) => (
                <button key={c.id} onClick={() => { setSearch(""); setSel(c.id); }}
                  className={cn("whitespace-nowrap px-3.5 py-1.5 rounded-full text-sm border", sel === c.id && !q ? "border-primary bg-primary/15 text-primary" : "border-card-border text-muted-foreground")}>
                  {c.name} <span className="text-xs opacity-70 tabular-nums">{counts.get(c.id) ?? 0}</span>
                </button>
              ))}
              {hasUncat && (
                <button onClick={() => { setSearch(""); setSel("none"); }} className={cn("whitespace-nowrap px-3.5 py-1.5 rounded-full text-sm border", sel === "none" && !q ? "border-primary bg-primary/15 text-primary" : "border-card-border text-muted-foreground")}>بدون تصنيف</button>
              )}
              <button onClick={() => setManageCats(true)} className="whitespace-nowrap px-3 py-1.5 rounded-full text-sm border border-dashed border-card-border text-muted-foreground flex items-center gap-1"><Settings2 className="w-3.5 h-3.5" />التصنيفات</button>
            </div>
          </div>

          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input className={cn(inputCls, "pr-9")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`دوّر في ${word}`} />
                {search && <button className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setSearch("")} aria-label="مسح"><X className="w-4 h-4" /></button>}
              </div>
              <button className={btnPrimary} onClick={newItem} disabled={!cats.data}><Plus className="w-4 h-4" />{shop.vocab.item[0]}</button>
            </div>

            {loading && [0, 1, 2, 3].map((i) => <Skel key={i} className="h-[84px] rounded-xl" />)}

            {!loading && !all.length && !q && (
              <Empty icon={<UtensilsCrossed className="w-5 h-5" />} title="المنيو فاضي"
                sub="ابدأ بتصنيف وأضف له، أو خلّنا نقرأ المنيو الورقي من صورة ونعبّيه لك."
                action={<div className="flex flex-wrap justify-center gap-2">
                  {canImport && <button className={btnPrimary} onClick={() => setTab("import")}><Upload className="w-4 h-4" />من صورة أو Excel</button>}
                  <button className={btnGhost} onClick={newItem}><Plus className="w-4 h-4" />أضف يدوياً</button>
                </div>} />
            )}

            {!loading && (all.length > 0 || q) && !visible.length && (
              <Empty icon={q ? <Search className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
                title={q ? `ما لقينا «${search}»` : "هذا التصنيف فاضي"}
                sub={q ? undefined : `أضف أول ${shop.vocab.item[0]} فيه.`}
                action={!q ? <button className={btnPrimary} onClick={newItem}><Plus className="w-4 h-4" />{shop.vocab.item[0]} جديد</button> : undefined} />
            )}

            {!loading && visible.length > 0 && (
              <ItemList key={`${q ? "q" : sel}`} items={visible} draggable={!q} categoryId={sel === "none" ? null : (sel as number)} cats={catList}
                onEdit={setEditing} onPlan={setUpgrade} />
            )}
          </div>
        </div>
      )}

      <Modal open={manageCats} onClose={() => setManageCats(false)} title="التصنيفات" sub="اسحب من المقبض عشان ترتّب.">
        <CategoryList cats={catList} counts={counts} sel={sel} onSelect={(s) => { setSel(s); setManageCats(false); }} hasUncat={hasUncat} />
      </Modal>

      {editing && <ItemEditor item={editing} categories={catList} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Categories ────────────────────────────────────────────────────

function CategoryList({ cats, counts, sel, onSelect, hasUncat }: { cats: Category[]; counts: Map<Sel, number>; sel: Sel | null; onSelect: (s: Sel) => void; hasUncat: boolean }) {
  const qc = useQueryClient();
  const [order, setOrderState] = useState<number[]>(cats.map((c) => c.id));
  const orderRef = useRef(order);
  const setOrder = (o: number[]) => { orderRef.current = o; setOrderState(o); };
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setOrder(cats.map((c) => c.id)); }, [cats]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string; nameEn: string } | null>(null);
  const byId = new Map(cats.map((c) => [c.id, c]));

  const add = useMutation({
    mutationFn: (name: string) => post<Category>("/api/menu/categories", { name }),
    onSuccess: (c) => {
      // Into the cache first, or the page sees an unknown id and snaps back to the first category.
      qc.setQueryData<Category[]>(CATS_KEY, (l) => [...(l ?? []), c]);
      setAdding(""); onSelect(c.id); qc.invalidateQueries({ queryKey: CATS_KEY });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const rename = useMutation({
    mutationFn: (r: { id: number; name: string; nameEn: string }) => patch(`/api/menu/categories/${r.id}`, { name: r.name, nameEn: r.nameEn }),
    onSuccess: () => { setRenaming(null); qc.invalidateQueries({ queryKey: CATS_KEY }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/api/menu/categories/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: CATS_KEY }); qc.invalidateQueries({ queryKey: ITEMS_KEY }); toast.success("انحذف التصنيف — أصنافه صارت «بدون تصنيف»"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const saveOrder = async (ids: number[]) => {
    qc.setQueryData<Category[]>(CATS_KEY, (l) => (l ? ids.map((id) => l.find((c) => c.id === id)!).filter(Boolean) : l));
    try { await post("/api/menu/categories/reorder", { ids }); }
    catch (e) { toast.error((e as Error).message); qc.invalidateQueries({ queryKey: CATS_KEY }); }
  };

  return (
    <div className="space-y-1">
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-1">
        {order.map((id) => {
          const c = byId.get(id);
          if (!c) return null;
          return (
            <CategoryRow key={id} c={c} count={counts.get(id) ?? 0} active={sel === id} onSelect={() => onSelect(id)}
              onDragStart={() => { dragging.current = true; }}
              onDragEnd={() => { dragging.current = false; if (orderRef.current.join() !== cats.map((x) => x.id).join()) saveOrder(orderRef.current); }}
              onRename={() => setRenaming({ id, name: c.name, nameEn: c.nameEn ?? "" })}
              onDelete={() => confirm(`حذف «${c.name}»؟ أصنافه ما تنحذف — تصير «بدون تصنيف».`) && remove.mutate(id)} />
          );
        })}
      </Reorder.Group>
      {hasUncat && (
        <button onClick={() => onSelect("none")} className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-start", sel === "none" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}>
          <span className="flex-1 italic">بدون تصنيف</span><span className="text-xs tabular-nums">{counts.get("none") ?? 0}</span>
        </button>
      )}
      <form className="flex items-center gap-1 pt-1" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) add.mutate(adding.trim()); }}>
        <input className={cn(inputCls, "py-1.5")} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="+ تصنيف جديد" />
        {adding.trim() && <button type="submit" className={iconBtn} disabled={add.isPending} aria-label="أضف">{add.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}</button>}
      </form>

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="تعديل التصنيف"
        footer={<>
          <button className={btnQuiet} onClick={() => setRenaming(null)}>إلغاء</button>
          <button className={btnPrimary} disabled={!renaming?.name.trim() || rename.isPending} onClick={() => renaming && rename.mutate(renaming)}>احفظ</button>
        </>}>
        {renaming && (
          <div className="space-y-3">
            <input autoFocus className={inputCls} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} placeholder="الاسم" />
            <input className={inputCls} dir="ltr" value={renaming.nameEn} onChange={(e) => setRenaming({ ...renaming, nameEn: e.target.value })} placeholder="English name" />
          </div>
        )}
      </Modal>
    </div>
  );
}

function CategoryRow({ c, count, active, onSelect, onDragStart, onDragEnd, onRename, onDelete }: {
  c: Category; count: number; active: boolean; onSelect: () => void; onDragStart: () => void; onDragEnd: () => void; onRename: () => void; onDelete: () => void;
}) {
  const controls = useDragControls();
  const [menu, setMenu] = useState(false);
  return (
    <Reorder.Item value={c.id} dragListener={false} dragControls={controls} onDragStart={onDragStart} onDragEnd={onDragEnd}
      className={cn("group relative flex items-center gap-1 rounded-lg text-sm select-none", active ? "bg-primary/15 text-primary" : "hover:bg-muted")}
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }} style={{ position: "relative" }}>
      <span className="p-2 cursor-grab active:cursor-grabbing text-muted-foreground/60 touch-none" onPointerDown={(e) => controls.start(e)} aria-label="اسحب"><GripVertical className="w-4 h-4" /></span>
      <button className="flex-1 min-w-0 text-start py-2 truncate" onClick={onSelect}>{c.name}</button>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      <button className={cn(iconBtn, "w-7 h-7 md:opacity-0 group-hover:opacity-100")} onClick={() => setMenu(!menu)} aria-label="خيارات"><MoreHorizontal className="w-4 h-4" /></button>
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute left-0 top-9 z-20 w-36 rounded-xl border border-popover-border bg-popover shadow-xl p-1 text-foreground">
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted text-start" onClick={() => { setMenu(false); onRename(); }}><Pencil className="w-3.5 h-3.5" />تعديل الاسم</button>
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-destructive/10 text-destructive text-start" onClick={() => { setMenu(false); onDelete(); }}><Trash2 className="w-3.5 h-3.5" />حذف</button>
          </div>
        </>
      )}
    </Reorder.Item>
  );
}

// ── Items ─────────────────────────────────────────────────────────

function ItemList({ items, draggable, categoryId, cats, onEdit, onPlan }: {
  items: MenuItem[]; draggable: boolean; categoryId: number | null; cats: Category[]; onEdit: (i: MenuItem) => void; onPlan: (m: string) => void;
}) {
  const shop = useShop();
  const qc = useQueryClient();
  const [order, setOrderState] = useState(items.map((i) => i.id));
  const orderRef = useRef(order);
  const setOrder = (o: number[]) => { orderRef.current = o; setOrderState(o); };
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setOrder(items.map((i) => i.id)); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(items.map((i) => [i.id, i]));
  const catName = (id: number | null) => cats.find((c) => c.id === id)?.name;

  const avail = useMutation({
    mutationFn: ({ id, available }: { id: number; available: boolean }) => patch("/api/menu/availability", { itemId: id, available }),
    onMutate: async ({ id, available }) => {
      await qc.cancelQueries({ queryKey: ITEMS_KEY });
      const prev = qc.getQueryData<MenuItem[]>(ITEMS_KEY);
      qc.setQueryData<MenuItem[]>(ITEMS_KEY, (l) => l?.map((i) => (i.id === id ? { ...i, branch: { ...i.branch, available } } : i)));
      return { prev };
    },
    onError: (e, _v, ctx) => { qc.setQueryData(ITEMS_KEY, ctx?.prev); toast.error((e as Error).message); },
    onSettled: () => qc.invalidateQueries({ queryKey: ITEMS_KEY }),
  });
  const dup = useMutation({
    mutationFn: (id: number) => post<MenuItem>(`/api/menu/items/${id}/duplicate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ITEMS_KEY }); toast.success("انعملت نسخة"); },
    onError: (e) => { if (isPlanError(e)) onPlan(e.message); else toast.error((e as Error).message); },
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/api/menu/items/${id}`),
    onMutate: async (id) => {
      const prev = qc.getQueryData<MenuItem[]>(ITEMS_KEY);
      qc.setQueryData<MenuItem[]>(ITEMS_KEY, (l) => l?.filter((i) => i.id !== id));
      return { prev };
    },
    onError: (e, _v, ctx) => { qc.setQueryData(ITEMS_KEY, ctx?.prev); toast.error((e as Error).message); },
    onSuccess: () => toast.success("انحذف"),
    onSettled: () => qc.invalidateQueries({ queryKey: ITEMS_KEY }),
  });
  const saveOrder = async (ids: number[]) => {
    try { await post("/api/menu/items/reorder", { ids, categoryId }); qc.invalidateQueries({ queryKey: ITEMS_KEY }); }
    catch (e) { toast.error((e as Error).message); qc.invalidateQueries({ queryKey: ITEMS_KEY }); }
  };

  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-2">
      {order.map((id) => {
        const it = byId.get(id);
        if (!it) return null;
        return (
          <ItemRow key={id} it={it} draggable={draggable} currency={shop.org.currency} catName={!draggable ? catName(it.categoryId) : undefined}
            onDragStart={() => { dragging.current = true; }}
            onDragEnd={() => { dragging.current = false; if (orderRef.current.join() !== items.map((x) => x.id).join()) saveOrder(orderRef.current); }}
            onEdit={() => onEdit(it)} onToggle={(available) => avail.mutate({ id, available })}
            onDuplicate={() => dup.mutate(id)} onDelete={() => confirm(`حذف «${it.name}» نهائياً؟`) && remove.mutate(id)} />
        );
      })}
    </Reorder.Group>
  );
}

function ItemRow({ it, draggable, currency, catName, onDragStart, onDragEnd, onEdit, onToggle, onDuplicate, onDelete }: {
  it: MenuItem; draggable: boolean; currency: string; catName?: string; onDragStart: () => void; onDragEnd: () => void;
  onEdit: () => void; onToggle: (v: boolean) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const controls = useDragControls();
  const [menu, setMenu] = useState(false);
  const img = it.images?.[0];
  const price = it.branch.price ?? it.price;
  const off = !it.branch.available || !it.isActive;
  return (
    <Reorder.Item value={it.id} dragListener={false} dragControls={controls} onDragStart={onDragStart} onDragEnd={onDragEnd}
      className="relative bg-card border border-card-border rounded-xl flex items-center gap-2 sm:gap-3 p-2 pe-3 select-none"
      whileDrag={{ scale: 1.01, boxShadow: "0 12px 32px rgba(0,0,0,0.4)", zIndex: 5 }} style={{ position: "relative" }}>
      {draggable ? (
        <span className="px-1 py-4 cursor-grab active:cursor-grabbing text-muted-foreground/50 touch-none" onPointerDown={(e) => controls.start(e)} aria-label="اسحب"><GripVertical className="w-4 h-4" /></span>
      ) : <span className="w-2" />}
      <button onClick={onEdit} className={cn("w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center", off && "opacity-50 grayscale")}>
        {img ? <img src={mediaUrl(img.sm ?? img.url)!} alt="" className="w-full h-full object-cover" style={img.blur ? { backgroundImage: `url(${img.blur})`, backgroundSize: "cover" } : undefined} />
          : <ImageIcon className="w-5 h-5 text-muted-foreground/40" />}
      </button>
      <button onClick={onEdit} className="flex-1 min-w-0 text-start py-1">
        <div className={cn("font-medium truncate", off && "text-muted-foreground")}>{it.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          <span className={cn("font-semibold tabular-nums", off ? "" : "text-primary")}>{formatMoney(price, currency)}</span>
          {it.branch.price != null && <span className="line-through opacity-60 tabular-nums">{it.price}</span>}
          {it.compareAtPrice != null && it.branch.price == null && <span className="line-through opacity-60 tabular-nums">{it.compareAtPrice}</span>}
          {it.kind === "service" && it.durationMin && <span>{it.durationMin} د</span>}
          {it.options?.length > 0 && <span>{it.options.length} خيارات</span>}
          {catName && <span>· {catName}</span>}
          {!it.isActive && <span className="text-amber-400">مخفي</span>}
          {!it.nameEn && <span className="opacity-60">بدون إنجليزي</span>}
        </div>
        {it.tags?.length > 0 && (
          <div className="hidden sm:flex flex-wrap gap-1 mt-1.5">
            {it.tags.slice(0, 4).map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{TAG_LABEL[t] ?? t}</span>)}
          </div>
        )}
      </button>
      <div className="flex flex-col items-center gap-1">
        <Toggle checked={it.branch.available} onChange={onToggle} label="متوفر" disabled={!it.isActive} />
        <span className={cn("text-[10px]", it.branch.available ? "text-muted-foreground" : "text-amber-400")}>{it.branch.available ? "متوفر" : "خلص"}</span>
      </div>
      <div className="relative">
        <button className={iconBtn} onClick={() => setMenu(!menu)} aria-label="خيارات"><MoreHorizontal className="w-4 h-4" /></button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute left-0 top-9 z-20 w-36 rounded-xl border border-popover-border bg-popover shadow-xl p-1 text-sm">
              <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted text-start" onClick={() => { setMenu(false); onEdit(); }}><Pencil className="w-3.5 h-3.5" />تعديل</button>
              <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-muted text-start" onClick={() => { setMenu(false); onDuplicate(); }}><Copy className="w-3.5 h-3.5" />نسخة</button>
              <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-destructive/10 text-destructive text-start" onClick={() => { setMenu(false); onDelete(); }}><Trash2 className="w-3.5 h-3.5" />حذف</button>
            </div>
          </>
        )}
      </div>
    </Reorder.Item>
  );
}
