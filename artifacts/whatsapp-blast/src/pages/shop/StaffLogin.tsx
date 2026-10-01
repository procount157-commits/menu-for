// ── /staff-login — the door for cashiers, hosts and branch managers ─
// Shop + username + password; the owner hands these out from «الموظفون».
// The shop is usually already in the link (?shop=bait-shami) so staff only
// type two things.

import { useState } from "react";
import { Link } from "wouter";
import { Loader2, Store, User, Lock, Eye, EyeOff, ListOrdered } from "lucide-react";
import { toast } from "sonner";
import { post } from "@/lib/shop-api";

/** Staff often paste the whole menu link; keep only the shop's slug. */
function slugOf(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  const noProto = s.replace(/^https?:\/\//, "");
  const parts = noProto.split(/[/?#]/).filter(Boolean);
  // "menufor.you/bait-shami" → "bait-shami"; "bait-shami" → "bait-shami"
  const tail = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return (tail ?? "").replace(/^@/, "");
}

export default function StaffLogin() {
  const params = new URLSearchParams(window.location.search);
  const [shop, setShop] = useState(params.get("shop") ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const fixedShop = !!params.get("shop");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = slugOf(shop);
    if (!slug || !username.trim() || !password) { toast.error("اكتب رابط المحل واسم الدخول وكلمة المرور"); return; }
    setBusy(true);
    try {
      await post("/api/staff-auth/login", { shop: slug, username: username.trim(), password });
      // A full reload so the auth context starts from the new staff session.
      window.location.href = "/queue";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر الدخول");
      setBusy(false);
    }
  };

  const input = "w-full ps-10 pe-3 py-3 bg-input border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base";

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-primary/15 text-primary mb-3">
            <ListOrdered className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold">دخول الموظفين</h1>
          <p className="text-sm text-muted-foreground mt-1">منيو فور يو · الصف والطلبات والحجوزات</p>
        </div>

        <form onSubmit={submit} className="bg-card border border-card-border rounded-2xl p-5 space-y-3.5 shadow-xl">
          <label className="block">
            <span className="block text-sm text-muted-foreground mb-1.5">رابط المحل</span>
            <div className="relative">
              <Store className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
              <input className={input} dir="ltr" value={shop} onChange={(e) => setShop(e.target.value)}
                placeholder="bait-shami" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                readOnly={fixedShop && !!shop} onDoubleClick={(e) => (e.currentTarget.readOnly = false)} />
            </div>
          </label>
          <label className="block">
            <span className="block text-sm text-muted-foreground mb-1.5">اسم الدخول</span>
            <div className="relative">
              <User className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
              <input className={input} dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={fixedShop} />
            </div>
          </label>
          <label className="block">
            <span className="block text-sm text-muted-foreground mb-1.5">كلمة المرور</span>
            <div className="relative">
              <Lock className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
              <input className={input} dir="ltr" type={show ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "إخفاء" : "إظهار"}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-muted-foreground hover:text-foreground">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>
          <button type="submit" disabled={busy}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} دخول
          </button>
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            ما عندك اسم دخول؟ صاحب المحل ينشئه لك من «الموظفون».
          </p>
        </form>

        <div className="text-center mt-5 text-sm">
          <Link href="/login" className="text-muted-foreground hover:text-primary underline underline-offset-4">أنا صاحب المحل — الدخول برقم الجوال</Link>
        </div>
      </div>
    </div>
  );
}
