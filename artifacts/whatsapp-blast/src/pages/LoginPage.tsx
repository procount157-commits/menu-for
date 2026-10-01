import { useState } from "react";
import { MfyMark } from "@/components/Layout";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Phone, Lock, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "register">(() => (new URLSearchParams(window.location.search).get("register") ? "register" : "login"));
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const { register } = useAuth();

  const inputCls = "w-full px-4 py-3 bg-input border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || !password.trim()) { toast.error("يرجى إدخال رقم الهاتف وكلمة المرور"); return; }
    setLoading(true);
    try {
      if (mode === "login") {
        await login(phone.trim(), password);
        navigate("/shop");
      } else {
        if (password.length < 6) { toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); setLoading(false); return; }
        await register(phone.trim(), password, displayName.trim() || undefined, code.trim() || undefined);
        navigate("/shop");
        toast.success("تم إنشاء حسابك بنجاح!");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex mb-4"><MfyMark className="w-16 h-16" /></div>
          <h1 className="text-2xl font-bold text-foreground">منيو فور يو</h1>
          <p className="text-muted-foreground text-sm mt-1">المنيو الرقمي والصف الرقمي وواتساب لمحلك</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-card-border rounded-2xl p-6 shadow-xl">
          {/* Mode Tabs */}
          <div className="flex rounded-xl bg-muted p-1 mb-6">
            {[
              { id: "login", label: "تسجيل الدخول" },
              { id: "register", label: "إنشاء حساب" },
            ].map(({ id, label }) => (
              <button key={id} type="button"
                onClick={() => setMode(id as "login" | "register")}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
                  mode === id ? "bg-card text-foreground shadow" : "text-muted-foreground hover:text-foreground"
                )}>
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">كود الدعوة *</label>
                  <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="الكود الذي وصلك من الإدارة" className={inputCls} dir="ltr" autoComplete="off" />
                  <p className="text-xs text-muted-foreground mt-1">التسجيل بدعوة. الكود يحدد خطتك ومدتها.</p>
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">الاسم (اختياري)</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: أحمد محمد" className={inputCls} />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">رقم الهاتف *</label>
              <div className="relative">
                <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="مثال: 971501234567"
                  className={inputCls + " pr-10"} dir="ltr" autoComplete="username"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">ادخل الرقم الدولي بدون + أو 00</p>
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-1.5">كلمة المرور *</label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type={showPass ? "text" : "password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "6 أحرف على الأقل" : "كلمة المرور"}
                  className={inputCls + " pr-10 pl-10"} autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors mt-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "جاري التحميل..." : mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          كل محل له منيوه وصفّه ورقم واتسابه — منفصل تماماً عن غيره
        </p>
        <p className="text-center text-sm mt-3">
          <a href="/staff-login" className="text-primary hover:underline">أنت موظف؟ ادخل من هنا</a>
        </p>
      </div>
    </div>
  );
}
