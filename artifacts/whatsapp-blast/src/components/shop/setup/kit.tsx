// ── Small pieces the setup pages share ────────────────────────────
// Buttons, a toggle, a modal, copy, upload and the plan notice. The shadcn
// Switch slides the wrong way under dir="rtl", so the toggle here is our own.

import { useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError, upload } from "@/lib/shop-api";

export const btn = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";
export const btnPrimary = cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90");
export const btnGhost = cn(btn, "border border-card-border bg-card hover:border-primary/50 text-foreground");
export const btnQuiet = cn(btn, "text-muted-foreground hover:text-foreground hover:bg-muted");
export const btnDanger = cn(btn, "border border-destructive/40 text-destructive hover:bg-destructive/10");
export const iconBtn = "inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40";

export function PageHeader({ icon, title, sub, actions }: { icon?: ReactNode; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">{icon}{title}</h1>
        {sub && <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-primary" : "bg-input border border-border")}
      dir="ltr"
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** A labelled row with a toggle, for settings. */
export function ToggleRow({ title, hint, checked, onChange, disabled }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={title} />
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-sm text-muted-foreground mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground/80 mt-1 leading-relaxed">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, sub, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          dir="rtl"
          className={cn(
            "fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "w-full bg-popover border border-popover-border shadow-2xl flex flex-col",
            "max-h-[92dvh] rounded-t-2xl sm:rounded-2xl",
            wide ? "sm:max-w-3xl" : "sm:max-w-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4",
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {sub ? <DialogPrimitive.Description className="text-xs text-muted-foreground mt-1">{sub}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className={iconBtn} aria-label="إغلاق"><X className="w-4 h-4" /></DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
          {footer && <div className="px-5 py-3 border-t border-border flex flex-wrap items-center justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CopyButton({ text, label = "نسخ", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn(btnGhost, "text-xs px-3 py-1.5", className)}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); }
        catch {
          // Clipboard needs a secure context; a hidden textarea works everywhere.
          const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand("copy"); ta.remove();
        }
        setDone(true); setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      {done ? "نُسخ" : label}
    </button>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

export function Empty({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl border border-dashed border-card-border">
      {icon && <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">{icon}</div>}
      <div className="font-medium">{title}</div>
      {sub && <div className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** No server record of printing exists, so the QR page leaves a mark here for the home checklist. */
export const qrDoneKey = (orgId: number) => `mfy:qr-done:${orgId}`;
export function markQrDone(orgId: number) { try { localStorage.setItem(qrDoneKey(orgId), "1"); } catch { /* private mode */ } }
export function isQrDone(orgId: number) { try { return localStorage.getItem(qrDoneKey(orgId)) === "1"; } catch { return false; } }

/** The server answers 402 {plan:true} when the plan does not include something. */
export const isPlanError = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 402 && !!e.body?.plan;

export function UpgradeNotice({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
      <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 leading-relaxed">
        <div>{message}</div>
        {/* No in-app upgrade page yet; plans are changed by the platform team. */}
        <div className="text-primary/80 text-xs mt-0.5">للترقية كلّم فريق منيو فور يو</div>
      </div>
      {onClose && <button className={iconBtn} onClick={onClose} aria-label="إخفاء"><X className="w-4 h-4" /></button>}
    </div>
  );
}

export interface StoredImage { url: string; sm?: string; md?: string; blur?: string }

/** A square drop target that uploads one picture to the menu image store. */
export function ImageDrop({ value, onChange, kind = "menu", className, label = "أضف صورة", round }: {
  value: string | null | undefined; onChange: (img: StoredImage | null) => void; kind?: "logo" | "cover" | "offer" | "menu";
  className?: string; label?: string; round?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { onChange(await upload<StoredImage>(`/api/menu/images?kind=${kind}`, f)); }
    catch (e) { (await import("sonner")).toast.error((e as Error).message); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <div
      className={cn("relative group overflow-hidden border border-dashed border-card-border bg-muted/40 flex items-center justify-center cursor-pointer hover:border-primary/60 transition-colors",
        round ? "rounded-full" : "rounded-xl", className)}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
    >
      {value ? <img src={value} alt="" className="absolute inset-0 w-full h-full object-cover" /> : (
        <div className="flex flex-col items-center gap-1 text-muted-foreground text-xs p-2 text-center">
          <ImagePlus className="w-5 h-5" />{label}
        </div>
      )}
      {busy && <div className="absolute inset-0 bg-background/70 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
      {value && !busy && (
        <button type="button" className="absolute top-1 left-1 w-6 h-6 rounded-full bg-background/80 text-foreground opacity-0 group-hover:opacity-100 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); onChange(null); }} aria-label="إزالة"><X className="w-3.5 h-3.5" /></button>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

/** Segmented tabs, scrollable on a phone. */
export function SegTabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; icon?: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
      <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/60 border border-card-border">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
            className={cn("flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm transition-colors",
              value === t.id ? "bg-card text-foreground shadow-sm border border-card-border" : "text-muted-foreground hover:text-foreground")}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Section card with a heading. */
export function Section({ title, sub, children, actions, className }: { title?: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cn("bg-card border border-card-border rounded-2xl p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {sub && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
