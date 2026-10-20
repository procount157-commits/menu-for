// ── «لا» نهائية: قراءة طلب الإيقاف ─────────────────────────────────
// منقولٌ من Flow Hub (opt-out.ts). صاحب العمل (٢٠ أكتوبر): «من اختار لا،
// اختار ما ترسل لي، خلاص ما هرسل له تاني». زر الإيقاف، أو «0» وحدها، أو أي
// رسالة قصيرة تطلب الإيقاف تضع الشخص في قائمة الإيقاف للأبد.

/**
 * Whether a message, on its own, asks us to stop. Short messages only — a
 * long one that mentions «إلغاء» is about something else — with punctuation
 * and emoji ignored, in Arabic, Gulf Arabic and English. Pure.
 */
export function asksToStop(text: string): boolean {
  const t = String(text ?? "").toLowerCase()
    .replace(/[ً-ْـ]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 45) return false;
  return /^(0|stop|unsubscribe|remove me|stop messaging|dont message me|do not message me|no more messages|توقف|وقف|اوقف|ايقاف|ايقاف الرسائل|الغاء|الغاء الاشتراك|لا ارسال|لا تراسلني|لا تراسلوني|لا ترسل|لا ترسلوا|لا ترسلو|لا ترسلون|لا ترسل لي|ارفع رقمي|ارفعوا رقمي|شيل رقمي|شيلوا رقمي|احذف رقمي|احذفوا رقمي|امسح رقمي|امسحوا رقمي|ما ابي رسايل|ما ابغي رسايل|ما ابي رسائل|ما ابغي رسائل|لا اريد رسائل|لا اريد رسايل|ما اريد رسائل|بطلوا ترسلوا|خلاص لا ترسلوا|ازعاج|مش عايز رسايل|مش عايز رسائل|ما بدي رسائل|ما بدي رسايل)( (لي|لو سمحت|please|plz|شكرا|من فضلك))?$/.test(t);
}
