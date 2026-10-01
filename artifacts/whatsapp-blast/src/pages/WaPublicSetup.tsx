import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, Wifi, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

interface QrResponse {
  qr:        string | null;
  status:    string;
  connected: boolean;
  phone:     string | null;
  name:      string | null;
}

export default function WaPublicSetup() {
  const [, params] = useRoute("/wa/:token");
  const token = params?.token ?? "";

  const [data,      setData]      = useState<QrResponse | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [dots,      setDots]      = useState(".");
  const [elapsed,   setElapsed]   = useState(0);
  const [forceMode, setForceMode] = useState(false);

  // Animated dots
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 600);
    return () => clearInterval(t);
  }, []);

  // Elapsed seconds counter (to detect stuck state)
  useEffect(() => {
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-restart: if no QR appears after 45 s and not yet connected, force a fresh session
  useEffect(() => {
    if (data?.connected || data?.qr || error || forceMode) return;
    if (elapsed === 45) {
      handleForceRestart();
    }
  }, [elapsed, data?.connected, data?.qr, error, forceMode]);

  const fetchQr = async (force = false) => {
    try {
      const url = force
        ? `/api/whatsapp/qr-public/${token}?force=1`
        : `/api/whatsapp/qr-public/${token}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "رابط غير صالح");
        setLoading(false);
        return;
      }
      const json: QrResponse = await res.json();
      setData(json);
      setError(null);
      if (json.qr) setElapsed(0); // reset timer when QR appears
    } catch {
      setError("تعذّر الاتصال بالخادم. تحقق من الإنترنت.");
    } finally {
      setLoading(false);
    }
  };

  const handleForceRestart = () => {
    setForceMode(true);
    setLoading(true);
    setData(null);
    setElapsed(0);
    fetchQr(true);
  };

  useEffect(() => {
    if (!token) return;
    fetchQr();
    const interval = setInterval(() => fetchQr(), 3000);
    return () => clearInterval(interval);
  }, [token]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "linear-gradient(135deg, #0d1f14 0%, #0f2d1a 50%, #0b1a10 100%)" }}
      dir="rtl"
    >
      {/* Logo */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30">
          <svg viewBox="0 0 24 24" fill="white" className="w-10 h-10">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.117 1.528 5.845L.057 23.172a.75.75 0 0 0 .92.92l5.327-1.471A11.955 11.955 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.922 0-3.722-.504-5.28-1.385l-.378-.214-3.915 1.081 1.081-3.916-.214-.378A9.955 9.955 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">منيو فور يو</h1>
          <p className="text-green-400/80 text-sm mt-1">ربط حساب الواتساب</p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 shadow-2xl">

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-400" />
            </div>
            <p className="text-red-400 text-center font-medium">{error}</p>
            <button
              onClick={() => { setLoading(true); setError(null); fetchQr(); }}
              className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 rounded-lg text-sm hover:bg-green-500/30 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> إعادة المحاولة
            </button>
          </div>
        )}

        {/* Loading */}
        {!error && loading && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-10 h-10 animate-spin text-green-400" />
            <p className="text-white/60 text-sm">جاري تحميل QR كود{dots}</p>
          </div>
        )}

        {/* Connected */}
        {!error && !loading && data?.connected && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
            <div className="text-center">
              <p className="text-green-400 font-bold text-lg">تم الربط بنجاح! ✅</p>
              {data.phone && (
                <p className="text-white/70 text-sm mt-1" dir="ltr">+{data.phone}</p>
              )}
              {data.name && (
                <p className="text-white/50 text-xs mt-0.5">{data.name}</p>
              )}
            </div>
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-2">
              <Wifi className="w-4 h-4 text-green-400" />
              <span className="text-green-400 text-sm">الواتساب متصل وجاهز</span>
            </div>
            <p className="text-white/40 text-xs text-center">يمكنك إغلاق هذه الصفحة الآن</p>
          </div>
        )}

        {/* QR Ready */}
        {!error && !loading && !data?.connected && data?.qr && (
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white p-3 rounded-xl shadow-inner">
              <img src={data.qr} alt="QR Code" className="w-56 h-56 block" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-white font-medium text-sm">امسح الرمز بواتساب</p>
              <p className="text-white/50 text-xs">افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/30">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              يتجدد تلقائياً كل 5 ثوانٍ
            </div>
          </div>
        )}

        {/* Waiting for QR */}
        {!error && !loading && !data?.connected && !data?.qr && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-8 h-8 animate-spin text-green-400/60" />
            <div className="text-center">
              <p className="text-white/70 text-sm">في انتظار QR كود{dots}</p>
              <p className="text-white/30 text-xs mt-1">
                {elapsed < 15
                  ? "جاري تحضير الجلسة…"
                  : elapsed < 40
                  ? `انتظار ${elapsed} ثانية…`
                  : "يتم إعادة التهيئة تلقائياً…"}
              </p>
            </div>
            {/* Auto-restart after 45 s — triggered via useEffect below */}
            <button
              onClick={handleForceRestart}
              className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-sm hover:bg-green-500/30 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              لا يظهر QR؟ اضغط هنا للإعادة
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-white/20 text-xs text-center">
        منيو فور يو · المنيو والصف الرقمي وواتساب
      </p>
    </div>
  );
}
