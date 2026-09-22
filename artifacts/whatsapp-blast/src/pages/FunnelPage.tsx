/**
 * الفنال التسويقي الحقيقي
 * - اختيار حملة
 * - مراحل: أُرسل → ضغط الرابط → رد → لم يرد → لم يضغط → ليدز ساخنة
 * - لكل مرحلة: عرض الأرقام، إنشاء قائمة، إرسال متابعة
 */
import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  TrendingUp, Users, Send, Plus, Loader2, MessageSquare,
  CheckCircle2, XCircle, MousePointerClick, ChevronDown,
  Flame, UserX, ArrowLeft, Download, RefreshCw, FolderPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── helpers ──────────────────────────────────────────────────────
async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "حدث خطأ");
  return data;
}

// ── Types ─────────────────────────────────────────────────────────
interface Campaign { id: number; name: string; status: string; createdAt: string }

interface FunnelStage {
  count: number;
  phones: string[];
}

interface TrackingLink {
  id: number;
  title: string;
  code: string;
  clicks: number;
}

interface FunnelData {
  campaign: Campaign;
  tracking: {
    mode: "campaign" | "time";
    campaignLinks: TrackingLink[];
  };
  stages: {
    sent:       FunnelStage;
    clicked:    FunnelStage;
    replied:    FunnelStage;
    noReply:    FunnelStage;
    notClicked: FunnelStage;
    hotLeads:   FunnelStage;
  };
}

type StageKey = "sent" | "clicked" | "replied" | "noReply" | "notClicked" | "hotLeads";

interface StageConfig {
  key:      StageKey;
  label:    string;
  sublabel: string;
  color:    string;
  bg:       string;
  border:   string;
  icon:     typeof Send;
  section:  "funnel" | "segments";
}

const STAGES: StageConfig[] = [
  {
    key: "sent",       label: "أُرسلت",          sublabel: "إجمالي الرسائل المرسلة",
    color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20",   icon: Send,               section: "funnel",
  },
  {
    key: "clicked",    label: "ضغط الرابط",       sublabel: "ضغط على رابط متتبع",
    color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20", icon: MousePointerClick,  section: "funnel",
  },
  {
    key: "replied",    label: "ردّ",               sublabel: "أرسل رسالة واتساب بعد الحملة",
    color: "text-green-400",  bg: "bg-green-500/10",  border: "border-green-500/20",  icon: MessageSquare,      section: "funnel",
  },
  {
    key: "hotLeads",   label: "ليدز ساخنة 🔥",    sublabel: "ضغط ولم يرد بعد — استهدفه الآن",
    color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20", icon: Flame,              section: "segments",
  },
  {
    key: "noReply",    label: "لم يرد",            sublabel: "لم يرسل أي رسالة بعد الحملة",
    color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: UserX,              section: "segments",
  },
  {
    key: "notClicked", label: "لم يضغط الرابط",   sublabel: "لم يتفاعل مع أي رابط",
    color: "text-red-400",    bg: "bg-red-500/10",    border: "border-red-500/20",    icon: XCircle,            section: "segments",
  },
];

// ── Segment Action Modal ──────────────────────────────────────────
function SegmentModal({
  stageKey, stageName, phones, campaignId, onClose,
}: {
  stageKey: StageKey; stageName: string; phones: string[];
  campaignId: number; onClose: () => void;
}) {
  const [view, setView]             = useState<"options" | "phones" | "createList" | "followUp">("options");
  const [groupName, setGroupName]   = useState("");
  const [followMsg, setFollowMsg]   = useState("");
  const [creating, setCreating]     = useState(false);
  const [sending, setSending]       = useState(false);

  const createList = async () => {
    if (!groupName.trim()) { toast.error("أدخل اسم القائمة"); return; }
    setCreating(true);
    try {
      const d = await apiFetch(`/funnel/campaign/${campaignId}/extract`, {
        method: "POST",
        body: JSON.stringify({ stage: stageKey, groupName: groupName.trim() }),
      });
      toast.success(`تم إنشاء القائمة "${d.groupName}" بـ ${d.count} رقم`);
      onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setCreating(false); }
  };

  const sendFollowUp = async () => {
    if (!followMsg.trim()) { toast.error("أدخل نص الرسالة"); return; }
    setSending(true);
    try {
      const d = await apiFetch(`/follow-ups/campaigns/${campaignId}/send-follow-up`, {
        method: "POST",
        body: JSON.stringify({ message: followMsg, afterDays: 0 }),
      });
      toast.success(d.message || "تم بدء الإرسال");
      onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setSending(false); }
  };

  const exportPhones = () => {
    const txt = phones.join("\n");
    const blob = new Blob([txt], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${stageKey}-phones.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir="rtl">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          {view !== "options" && (
            <button onClick={() => setView("options")} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4 rotate-180" />
            </button>
          )}
          <h2 className="font-bold text-foreground flex-1">{stageName} — {phones.length} رقم</h2>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {/* Options */}
          {view === "options" && (
            <div className="space-y-3">
              <button onClick={() => setView("phones")}
                className="w-full flex items-center gap-3 p-4 bg-muted/40 border border-border rounded-xl hover:bg-muted/70 transition-colors text-right">
                <Users className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-foreground text-sm">عرض الأرقام</p>
                  <p className="text-xs text-muted-foreground">مشاهدة قائمة الأرقام في هذه المرحلة</p>
                </div>
              </button>
              <button onClick={() => setView("createList")}
                className="w-full flex items-center gap-3 p-4 bg-muted/40 border border-border rounded-xl hover:bg-muted/70 transition-colors text-right">
                <FolderPlus className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-foreground text-sm">إنشاء قائمة جهات</p>
                  <p className="text-xs text-muted-foreground">أضف هذه الأرقام لقائمة لإعادة استهدافها</p>
                </div>
              </button>
              <button onClick={() => setView("followUp")}
                className="w-full flex items-center gap-3 p-4 bg-muted/40 border border-border rounded-xl hover:bg-muted/70 transition-colors text-right">
                <Send className="w-5 h-5 text-primary flex-shrink-0" />
                <div>
                  <p className="font-medium text-foreground text-sm">إرسال متابعة الآن</p>
                  <p className="text-xs text-muted-foreground">أرسل رسالة متابعة فورية لهذه الأرقام</p>
                </div>
              </button>
              <button onClick={exportPhones}
                className="w-full flex items-center gap-3 p-4 bg-muted/40 border border-border rounded-xl hover:bg-muted/70 transition-colors text-right">
                <Download className="w-5 h-5 text-purple-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-foreground text-sm">تصدير الأرقام</p>
                  <p className="text-xs text-muted-foreground">تحميل الأرقام كملف TXT</p>
                </div>
              </button>
            </div>
          )}

          {/* Phones list */}
          {view === "phones" && (
            <div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border/50 mb-3">
                {phones.slice(0, 200).map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-mono text-foreground" dir="ltr">{p}</span>
                    <span className="text-[10px] text-muted-foreground">#{i + 1}</span>
                  </div>
                ))}
                {phones.length > 200 && (
                  <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                    + {phones.length - 200} رقم آخر — استخدم التصدير لرؤية الكل
                  </div>
                )}
              </div>
              <button onClick={exportPhones}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-muted text-foreground rounded-xl text-sm hover:bg-muted/80 transition-colors">
                <Download className="w-4 h-4" /> تصدير الكل ({phones.length})
              </button>
            </div>
          )}

          {/* Create list */}
          {view === "createList" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">اسم القائمة الجديدة *</label>
                <input
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder={`متابعة — ${stageName}`}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                />
              </div>
              <div className="bg-muted/40 rounded-xl p-3 text-xs text-muted-foreground">
                سيتم إنشاء قائمة جهات جديدة بـ <strong className="text-foreground">{phones.length} رقم</strong>. يمكنك استخدامها في أي حملة جديدة.
              </div>
              <button onClick={createList} disabled={creating}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                إنشاء القائمة
              </button>
            </div>
          )}

          {/* Follow-up message */}
          {view === "followUp" && (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400">
                ستُرسل هذه الرسالة مباشرة عبر واتساب لـ <strong>{phones.length} رقم</strong> لم يرد على حملتك
              </div>
              <textarea
                value={followMsg}
                onChange={e => setFollowMsg(e.target.value)}
                rows={4}
                placeholder="نص رسالة المتابعة... يمكن استخدام {الاسم} للتخصيص"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
              />
              <button onClick={sendFollowUp} disabled={sending || !followMsg.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                إرسال المتابعة
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Funnel visual bar ─────────────────────────────────────────────
function FunnelBar({ label, count, total, color, bg, border, icon: Icon, sublabel, pct }: {
  label: string; count: number; total: number; color: string; bg: string; border: string;
  icon: typeof Send; sublabel: string; pct: number;
}) {
  const width = total > 0 ? Math.max(20, Math.round((count / total) * 100)) : 0;

  return (
    <div className="flex items-center gap-4">
      {/* Label */}
      <div className="w-36 text-right flex-shrink-0">
        <p className="text-sm font-medium text-foreground flex items-center justify-end gap-1.5">
          <Icon className={cn("w-3.5 h-3.5", color)} />
          {label}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>
      </div>
      {/* Bar */}
      <div className="flex-1 relative h-10">
        <div className="absolute inset-0 bg-muted/30 rounded-lg" />
        <div
          className={cn("absolute inset-y-0 right-0 rounded-lg flex items-center justify-end px-3 transition-all", bg, border, "border")}
          style={{ width: `${width}%` }}
        >
          <span className={cn("text-xs font-bold", color)}>{count.toLocaleString()}</span>
        </div>
      </div>
      {/* Percent */}
      <div className="w-12 text-left flex-shrink-0">
        <span className="text-xs text-muted-foreground font-mono">{pct}%</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────
export default function FunnelPage() {
  const [campaigns, setCampaigns]       = useState<Campaign[]>([]);
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [funnel, setFunnel]             = useState<FunnelData | null>(null);
  const [loadingCamp, setLoadingCamp]   = useState(true);
  const [loadingFunnel, setLoadingFunnel] = useState(false);
  const [modal, setModal]               = useState<StageKey | null>(null);

  // Load campaigns
  useEffect(() => {
    apiFetch("/campaigns")
      .then((d: any) => {
        const list = Array.isArray(d) ? d : (d.campaigns ?? []);
        setCampaigns(list);
        const first = list.find((c: Campaign) => ["running", "completed", "paused"].includes(c.status));
        if (first) setSelectedId(first.id);
      })
      .catch(() => toast.error("فشل تحميل الحملات"))
      .finally(() => setLoadingCamp(false));
  }, []);

  // Load funnel data when campaign selected
  useEffect(() => {
    if (!selectedId) return;
    setLoadingFunnel(true);
    setFunnel(null);
    apiFetch(`/funnel/campaign/${selectedId}`)
      .then(setFunnel)
      .catch(e => toast.error(e.message))
      .finally(() => setLoadingFunnel(false));
  }, [selectedId]);

  const activeCampaigns = campaigns.filter(c => ["running", "completed", "paused"].includes(c.status));
  const sentTotal = funnel?.stages.sent.count ?? 0;

  const funnelStages = STAGES.filter(s => s.section === "funnel");
  const segmentStages = STAGES.filter(s => s.section === "segments");

  const activeModal = modal ? STAGES.find(s => s.key === modal) : null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" />
          الفنال التسويقي
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          تتبع مسار عملائك من الإرسال إلى التحويل — استهدف كل مرحلة بشكل منفصل
        </p>
      </div>

      {/* Campaign selector */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-foreground whitespace-nowrap">اختر الحملة:</label>
          <div className="relative flex-1 max-w-xs">
            <select
              value={selectedId ?? ""}
              onChange={e => setSelectedId(parseInt(e.target.value))}
              disabled={loadingCamp}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground appearance-none focus:outline-none focus:border-primary/50"
            >
              <option value="">-- اختر حملة --</option>
              {activeCampaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status === "running" ? "جارية" : c.status === "completed" ? "مكتملة" : "متوقفة"})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
          {selectedId && (
            <button
              onClick={() => {
                setLoadingFunnel(true);
                setFunnel(null);
                apiFetch(`/funnel/campaign/${selectedId}`)
                  .then(setFunnel)
                  .catch(e => toast.error(e.message))
                  .finally(() => setLoadingFunnel(false));
              }}
              className="p-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!loadingCamp && activeCampaigns.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground bg-card border border-border rounded-xl">
          <Send className="w-12 h-12 opacity-20" />
          <p className="text-sm">لا توجد حملات بعد</p>
          <Link href="/campaigns/new"
            className="text-xs text-primary hover:underline flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> أنشئ حملتك الأولى
          </Link>
        </div>
      )}

      {/* Loading */}
      {(loadingCamp || loadingFunnel) && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin ml-2" /><span>جاري التحميل...</span>
        </div>
      )}

      {/* Funnel data */}
      {!loadingFunnel && funnel && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "إجمالي المرسل", value: funnel.stages.sent.count,    color: "text-blue-400",   bg: "bg-blue-500/10" },
              { label: "ضغط الرابط",    value: funnel.stages.clicked.count,  color: "text-purple-400", bg: "bg-purple-500/10" },
              { label: "ردّ",            value: funnel.stages.replied.count,  color: "text-green-400",  bg: "bg-green-500/10" },
            ].map(s => (
              <div key={s.label} className={cn("rounded-xl p-4 text-center", s.bg)}>
                <p className={cn("text-3xl font-bold", s.color)}>{s.value.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                  {sentTotal > 0 ? `${Math.round((s.value / sentTotal) * 100)}%` : "—"}
                </p>
              </div>
            ))}
          </div>

          {/* Visual funnel */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-foreground text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                مسار التحويل
              </h2>
              {funnel.tracking && (
                <span className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-full border",
                  funnel.tracking.mode === "campaign"
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
                )}>
                  {funnel.tracking.mode === "campaign" ? "✓ استهداف دقيق بالحملة" : "⚠ تقريبي — أضف رابطاً متتبعاً"}
                </span>
              )}
            </div>
            {funnel.tracking?.campaignLinks?.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {funnel.tracking.campaignLinks.map(link => (
                  <span key={link.id} className="flex items-center gap-1.5 text-[11px] bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-full px-2.5 py-0.5">
                    <MousePointerClick className="w-3 h-3" />
                    {link.title || link.code} — {link.clicks.toLocaleString()} نقرة
                  </span>
                ))}
              </div>
            )}

            {funnelStages.map(stage => {
              const count = funnel.stages[stage.key].count;
              const pctVal = sentTotal > 0 ? Math.round((count / sentTotal) * 100) : 0;
              return (
                <FunnelBar
                  key={stage.key}
                  label={stage.label}
                  sublabel={stage.sublabel}
                  count={count}
                  total={sentTotal}
                  color={stage.color}
                  bg={stage.bg}
                  border={stage.border}
                  icon={stage.icon}
                  pct={pctVal}
                />
              );
            })}
          </div>

          {/* Segment cards */}
          <div>
            <h2 className="font-bold text-foreground text-sm mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              الشرائح — اتخذ إجراءً على كل مجموعة
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {segmentStages.map(stage => {
                const count = funnel.stages[stage.key].count;
                const phones = funnel.stages[stage.key].phones;
                const pctVal = sentTotal > 0 ? Math.round((count / sentTotal) * 100) : 0;
                return (
                  <div key={stage.key} className={cn("border rounded-xl p-4", stage.bg, stage.border)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", stage.bg, stage.border)}>
                          <stage.icon className={cn("w-5 h-5", stage.color)} />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground text-sm">{stage.label}</p>
                          <p className="text-xs text-muted-foreground">{stage.sublabel}</p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className={cn("text-2xl font-bold", stage.color)}>{count.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground text-left">{pctVal}% من المرسل</p>
                      </div>
                    </div>

                    {count > 0 && (
                      <div className="flex gap-2 mt-3 pt-3 border-t border-white/10">
                        <button
                          onClick={() => setModal(stage.key)}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors",
                            "bg-white/10 hover:bg-white/20 text-foreground"
                          )}
                        >
                          <Users className="w-3.5 h-3.5" />
                          عرض الأرقام وإجراء
                        </button>
                        <button
                          onClick={() => setModal(stage.key)}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" />
                          متابعة
                        </button>
                      </div>
                    )}

                    {count === 0 && (
                      <div className="mt-3 pt-3 border-t border-white/10 text-center text-xs text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-green-400/50" />
                        لا توجد أرقام في هذه المرحلة
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* How it works note */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-400">
            <strong>ملاحظة:</strong> بيانات "ضغط الرابط" تأتي من <strong>الروابط المتتبعة</strong> (قسم تتبع الحملات).
            لضمان دقة البيانات، استخدم روابط متتبعة في حملاتك مع <code className="bg-blue-500/20 px-1 rounded">?p={"{الرقم}"}</code>.
            بيانات "ردّ" تُسجَّل تلقائياً من أي رسالة واتساب واردة بعد الحملة.
          </div>
        </>
      )}

      {/* No campaign selected */}
      {!loadingCamp && !loadingFunnel && !funnel && activeCampaigns.length > 0 && !selectedId && (
        <div className="text-center py-12 text-muted-foreground bg-card border border-border rounded-xl">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">اختر حملة من القائمة أعلاه لرؤية الفنال</p>
        </div>
      )}

      {/* Modal */}
      {modal && activeModal && funnel && (
        <SegmentModal
          stageKey={modal}
          stageName={activeModal.label}
          phones={funnel.stages[modal].phones}
          campaignId={funnel.campaign.id}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
