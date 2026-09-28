// Decodes Baileys/WhatsApp disconnect status codes into Arabic explanations,
// severity, and a recommended action. Shared by the diagnostics root-cause
// analysis and the auto-maintenance engine so both agree on what each code
// means — do not duplicate this mapping elsewhere.

export type DisconnectSeverity = "info" | "warning" | "critical";

export interface DisconnectReasonInfo {
  code: number | null;
  key: string;
  label: string;
  explanation: string;
  severity: DisconnectSeverity;
  recommendation: string;
}

const REASON_MAP: Record<number, Omit<DisconnectReasonInfo, "code">> = {
  401: {
    key: "loggedOut",
    label: "تسجيل خروج (401)",
    explanation: "تم فصل الجهاز من واتساب — إما المستخدم أزاله من «الأجهزة المرتبطة» أو واتساب فرض تسجيل الخروج (غالباً بسبب نشاط مقيّد).",
    severity: "critical",
    recommendation: "امسح كود QR جديد لإعادة الربط. إذا تكرر هذا بعد كل ربط، توقف عن الإرسال الجماعي لمدة 24-48 ساعة قبل إعادة المحاولة.",
  },
  403: {
    key: "forbidden",
    label: "ممنوع (403)",
    explanation: "خوادم واتساب رفضت الاتصال صراحة — عادة يعني هذا أن الحساب محظور أو مقيّد بشكل كامل.",
    severity: "critical",
    recommendation: "توقف فوراً عن أي إرسال. الحساب على الأرجح محظور من واتساب ويحتاج جهاز/رقم جديد.",
  },
  408: {
    key: "timedOut",
    label: "انتهت المهلة (408)",
    explanation: "لم يستجب الاتصال في الوقت المحدد — قد يكون بطء شبكة، أو (أثناء عرض QR) انتهاء صلاحية الكود دون مسحه.",
    severity: "warning",
    recommendation: "إذا تكرر أثناء QR، امسح الكود بسرعة أكبر. إذا تكرر أثناء الاتصال العادي فهذا يشير لبطء أو عدم استقرار الشبكة.",
  },
  405: {
    key: "handshakeRejected",
    label: "رفض المصافحة (405)",
    explanation: "رفض خادم واتساب إصدار العميل المُرسَل في المصافحة — قبل أي تحقق من الاعتمادات، فليس هذا رفضاً للجلسة. يحدث حين يتعذّر جلب الإصدار الحالي فيُستخدم إصدار قديم.",
    severity: "warning",
    recommendation: "لا تمسح QR. يُعيد النظام جلب الإصدار الحالي ويتصل تلقائياً خلال دقائق. إن استمر أكثر من ١٠ دقائق فتأكد أن السيرفر يصل إلى الإنترنت.",
  },
  411: {
    key: "multideviceMismatch",
    label: "تعارض الأجهزة المتعددة (411)",
    explanation: "عدم توافق في بيانات الجلسة متعددة الأجهزة — غالباً بيانات جلسة تالفة أو قديمة.",
    severity: "critical",
    recommendation: "أعد ضبط الجلسة (إعادة ضبط + مسح QR جديد) — لا يمكن إصلاح هذا تلقائياً دون مسح البيانات القديمة.",
  },
  428: {
    key: "connectionClosed",
    label: "إغلاق طبيعي (428)",
    explanation: "أغلق خادم واتساب الاتصال بشكل نظيف — دورة تدوير طبيعية للجلسة، ليست خطأً.",
    severity: "info",
    recommendation: "لا حاجة لأي إجراء — يعيد النظام الاتصال تلقائياً خلال ثوانٍ.",
  },
  440: {
    key: "connectionReplaced",
    label: "استبدال الجلسة (440)",
    explanation: "تم فتح واتساب على نفس الرقم من مكان آخر (متصفح/جهاز إضافي) فاستبدل جلسة البوت — هذا يقطع الاتصال قسراً وقد يُفشل أي رسالة قيد الإرسال في تلك اللحظة.",
    severity: "critical",
    recommendation: "تأكد أن لا أحد يفتح WhatsApp Web أو تطبيق واتساب لنفس الرقم على جهاز/متصفح آخر أثناء تشغيل الحملات.",
  },
  500: {
    key: "badSession",
    label: "جلسة تالفة (500)",
    explanation: "بيانات الجلسة (مفاتيح التشفير) تالفة أو غير متوافقة مع خوادم واتساب.",
    severity: "critical",
    recommendation: "يتطلب إعادة ضبط الجلسة بالكامل ومسح QR جديد — لا يمكن إصلاحه بإعادة المحاولة فقط.",
  },
  515: {
    key: "restartRequired",
    label: "إعادة تشغيل مطلوبة (515)",
    explanation: "طلب خادم واتساب إعادة تشغيل نظيفة للجلسة — دورة طبيعية تحدث كل ~80 ثانية بعد الاتصال الأولي.",
    severity: "info",
    recommendation: "لا حاجة لأي إجراء — يعيد النظام الاتصال تلقائياً خلال 2 ثانية.",
  },
};

export function decodeDisconnectReason(code: number | null | undefined): DisconnectReasonInfo {
  if (code == null || !REASON_MAP[code]) {
    return {
      code: code ?? null,
      key: "unknown",
      label: code != null ? `سبب غير معروف (${code})` : "بدون سبب محدد",
      explanation: "لم يُصنَّف هذا السبب بعد — راجع تفاصيل الحدث الخام للمزيد من السياق.",
      severity: "warning",
      recommendation: "راقب تكرار هذا السبب؛ إذا استمر، تواصل للحصول على دعم إضافي.",
    };
  }
  return { code, ...REASON_MAP[code] };
}

/**
 * QR-scan cycles that expired without being scanned. Not a Baileys disconnect
 * status code (no `reason=` present in the event detail) — surfaced as its
 * own bucket so it doesn't collapse into the generic "unknown" reason.
 */
export const QR_TIMEOUT_REASON: DisconnectReasonInfo = {
  code: null,
  key: "qrTimeout",
  label: "لم يُمسح رمز QR في الوقت المحدد",
  explanation: "تم عرض رمز QR جديد لكن لم يتم مسحه ضوئياً قبل انتهاء صلاحيته، فأعاد النظام توليد كود آخر.",
  severity: "warning",
  recommendation: "افتح صفحة «ربط الواتساب» وامسح رمز QR الجديد بسرعة باستخدام تطبيق واتساب على هاتفك (الأجهزة المرتبطة).",
};

/** Reasons that represent normal, expected session churn — not failures. */
export const BENIGN_DISCONNECT_KEYS = new Set(["connectionClosed", "restartRequired"]);
