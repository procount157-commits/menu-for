// Shared classification of message_logs.error strings into human-readable
// Arabic categories. Used by both the per-campaign failure-report endpoint
// and the account-wide root-cause diagnosis engine — keep this the single
// source of truth so a new error code (e.g. SOCKET_CLOSED_MID_SEND) only
// needs to be added once.

export interface FailureCategory {
  key: string;
  label: string;
  pattern: RegExp;
  retryable: boolean;
}

export const FAILURE_CATEGORIES: FailureCategory[] = [
  { pattern: /NOT_ON_WHATSAPP/i,                                                       key: "not_on_wa",        label: "رقم غير مسجل في واتساب",                             retryable: false },
  { pattern: /WA_DISCONNECTED_REPEATED/i,                                              key: "wa_disc_repeat",   label: "انقطاع متكرر في الاتصال",                             retryable: true  },
  { pattern: /SOCKET_CLOSED_MID_SEND/i,                                                key: "socket_reconnect", label: "انقطع الاتصال أثناء الإرسال (تمت إعادة المحاولة)",     retryable: true  },
  { pattern: /SEND_TIMEOUT/i,                                                          key: "timeout",          label: "انتهت مهلة الإرسال (timeout)",                        retryable: true  },
  { pattern: /MEDIA_NOT_FOUND|MEDIA_CONFIG_ERR|ENOENT/i,                              key: "media_err",        label: "ملف الوسائط مفقود أو غير صالح",                       retryable: false },
  { pattern: /غير متصل|not connected|disconnected|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i, key: "conn_err",         label: "خطأ في الاتصال بواتساب",                              retryable: true  },
];

export interface ClassifiedFailure {
  key: string;
  label: string;
  retryable: boolean;
}

export function classifyFailure(errStr: string | null | undefined): ClassifiedFailure {
  const s = errStr ?? "";
  for (const cat of FAILURE_CATEGORIES) {
    if (cat.pattern.test(s)) {
      return { key: cat.key, label: cat.label, retryable: cat.retryable };
    }
  }
  return { key: "other", label: "أخطاء أخرى", retryable: true };
}

export const NON_RETRYABLE_PATTERN = /NOT_ON_WHATSAPP|MEDIA_NOT_FOUND|MEDIA_CONFIG_ERR|ENOENT/i;
