// ── Arabic first, English one tap away ────────────────────────────

import { useSyncExternalStore } from "react";

export type Lang = "ar" | "en";

const S = {
  open: ["مفتوح الآن", "Open now"],
  closed: ["مغلق الآن", "Closed now"],
  closesAt: ["يغلق", "Closes"],
  opensAt: ["يفتح", "Opens"],
  menu: ["المنيو", "Menu"],
  offers: ["العروض", "Offers"],
  search: ["ابحث في المنيو", "Search the menu"],
  noResults: ["ما لقينا شي بهالاسم", "Nothing matches that"],
  soldOut: ["نفذت الكمية", "Sold out"],
  add: ["أضف", "Add"],
  addToCart: ["أضف للسلة", "Add to order"],
  required: ["مطلوب", "Required"],
  chooseUpTo: ["اختر حتى", "Choose up to"],
  optional: ["اختياري", "Optional"],
  note: ["ملاحظة للمطبخ", "Note for the kitchen"],
  notePh: ["مثلاً: بدون بصل", "e.g. no onions"],
  cart: ["طلبك", "Your order"],
  viewCart: ["عرض الطلب", "View order"],
  items: ["أصناف", "items"],
  total: ["الإجمالي", "Total"],
  orderType: ["نوع الطلب", "Order type"],
  dine_in: ["داخل المحل", "Dine-in"],
  pickup: ["استلام", "Pickup"],
  delivery: ["توصيل", "Delivery"],
  preorder: ["طلب مسبق", "Pre-order"],
  table: ["رقم الطاولة", "Table"],
  name: ["الاسم", "Name"],
  namePh: ["اسمك", "Your name"],
  address: ["عنوان التوصيل", "Delivery address"],
  addressPh: ["المنطقة، الشارع، رقم المبنى", "Area, street, building"],
  when: ["موعد الاستلام", "Pickup time"],
  notes: ["ملاحظات", "Notes"],
  offersOptIn: ["أرسلوا لي العروض على واتساب", "Send me offers on WhatsApp"],
  sendOnWa: ["أرسل الطلب على واتساب", "Send order on WhatsApp"],
  orderNoWa: ["أرسل الطلب", "Place order"],
  emptyCart: ["السلة فارغة", "Your order is empty"],
  remove: ["حذف", "Remove"],
  joinQueue: ["احجز دورك", "Join the queue"],
  inQueue: ["في الصف", "in line"],
  ahead: ["قدامك", "Ahead of you"],
  aheadShort: ["قدامك", "ahead"],
  people: ["أشخاص", "people"],
  partySize: ["عدد الأشخاص", "Party size"],
  service: ["الخدمة", "Service"],
  anyService: ["أي خدمة", "Any service"],
  joinWa: ["انضم وتابع على واتساب", "Join & follow on WhatsApp"],
  joinNoWa: ["انضم بدون واتساب", "Join without WhatsApp"],
  waPhoneOpt: ["أو اكتب رقم واتساب لنرسل لك", "or type a WhatsApp number to be told"],
  queuePaused: ["الصف متوقف مؤقتاً", "The queue is paused"],
  queueClosed: ["الصف مغلق الآن", "The queue is closed"],
  queueFull: ["الصف ممتلئ حالياً", "The queue is full right now"],
  qrOnly: ["الانضمام من داخل المحل — امسح الكود على الشاشة", "Join from inside — scan the code on the screen"],
  yourTicket: ["تذكرتك", "Your ticket"],
  yourNumber: ["رقمك", "Your number"],
  eta: ["الوقت التقريبي", "Estimated wait"],
  yourTurn: ["جاء دورك!", "It's your turn!"],
  yourTurnSub: ["تفضّل الآن", "Please come in now"],
  youreNext: ["أنت التالي", "You're next"],
  waiting: ["بالانتظار", "Waiting"],
  served: ["تمت خدمتك", "You've been served"],
  noShow: ["فاتك الدور", "You missed your turn"],
  left: ["خرجت من الصف", "You left the queue"],
  leave: ["أغادر الصف", "Leave the queue"],
  leaveConfirm: ["متأكد تبي تطلع من الصف؟", "Leave the queue?"],
  onMyWay: ["أنا في الطريق", "I'm on my way"],
  onMyWayDone: ["أخبرناهم إنك في الطريق", "We told them you're coming"],
  followWa: ["تابع على واتساب", "Follow on WhatsApp"],
  waLinked: ["مربوط بواتساب — بنرسل لك لما يقرب دورك", "Linked to WhatsApp — we'll message you when you're close"],
  waNotLinked: ["أرسل الرسالة الجاهزة على واتساب ليصلك إشعار دورك", "Send the ready message on WhatsApp to get notified"],
  rejoin: ["ارجع للصف", "Rejoin the queue"],
  nowServing: ["الآن", "Now serving"],
  orderWhileWaiting: ["اطلب الآن ليجهز مع دورك", "Order now so it's ready with your turn"],
  browseMenu: ["تصفّح المنيو", "Browse the menu"],
  book: ["احجز", "Book"],
  bookTitle: ["الحجز", "Booking"],
  date: ["اليوم", "Date"],
  time: ["الوقت", "Time"],
  noSlots: ["ما فيه أوقات متاحة في هذا اليوم", "No times left this day"],
  phone: ["رقم الواتساب", "WhatsApp number"],
  phonePh: ["05x xxx xxxx", "05x xxx xxxx"],
  confirmBooking: ["أكّد الحجز", "Confirm booking"],
  confirmOnWa: ["أكّد على واتساب", "Confirm on WhatsApp"],
  bookingConfirmed: ["تم تأكيد حجزك", "Your booking is confirmed"],
  bookingPending: ["حجزك بانتظار التأكيد", "Your booking is awaiting confirmation"],
  bookingCancelled: ["تم إلغاء الحجز", "Booking cancelled"],
  cancelBooking: ["إلغاء الحجز", "Cancel booking"],
  cancelConfirm: ["متأكد تبي تلغي الحجز؟", "Cancel this booking?"],
  addToCalendar: ["أضف للتقويم", "Add to calendar"],
  directions: ["الاتجاهات", "Directions"],
  call: ["اتصال", "Call"],
  orderStatus: ["حالة الطلب", "Order status"],
  st_pending: ["بانتظار رسالتك على واتساب", "Waiting for your WhatsApp message"],
  st_received: ["وصلنا طلبك", "Order received"],
  st_preparing: ["قيد التحضير", "Being prepared"],
  st_ready: ["جاهز للاستلام", "Ready"],
  st_completed: ["تم التسليم", "Completed"],
  st_cancelled: ["أُلغي", "Cancelled"],
  sendNow: ["أرسل الآن على واتساب", "Send it on WhatsApp now"],
  orderCode: ["رقم الطلب", "Order"],
  showCode: ["أعطِ هذا الرقم للموظف", "Show this number to the staff"],
  back: ["رجوع", "Back"],
  close: ["إغلاق", "Close"],
  branches: ["الفروع", "Branches"],
  hours: ["ساعات العمل", "Hours"],
  poweredBy: ["منيو فور يو", "Menu For You"],
  notFound: ["الصفحة غير موجودة", "Page not found"],
  notFoundSub: ["تأكد من الرابط أو امسح الكود من جديد", "Check the link or scan the code again"],
  offline: ["الاتصال ضعيف — نحاول التحديث", "Weak connection — retrying"],
  min: ["دقيقة", "min"],
  minutesAgo: ["منذ", "ago"],
  kcal: ["سعرة", "kcal"],
  minutes: ["دقيقة", "min"],
  scanToJoin: ["امسح للانضمام للصف", "Scan to join the queue"],
  next: ["القادمون", "Next"],
  waitingCount: ["بالانتظار", "waiting"],
  tag_new: ["جديد", "New"], tag_popular: ["الأكثر طلباً", "Popular"], tag_spicy: ["حار", "Spicy"],
  tag_vegetarian: ["نباتي", "Vegetarian"], tag_vegan: ["نباتي صرف", "Vegan"], tag_chef: ["اختيار الشيف", "Chef's pick"],
  tag_preorder: ["بالطلب المسبق", "Pre-order"], tag_gluten_free: ["خالٍ من الجلوتين", "Gluten-free"], tag_offer: ["عرض", "Offer"],
} as const;

export type Key = keyof typeof S;

let current: Lang = "ar";
const listeners = new Set<() => void>();

export function initLang(slug: string | null, fallback: Lang) {
  let l: Lang = fallback;
  try {
    const q = new URLSearchParams(location.search).get("lang");
    const saved = slug ? localStorage.getItem(`mfy:${slug}:lang`) : null;
    if (q === "ar" || q === "en") l = q; else if (saved === "ar" || saved === "en") l = saved;
  } catch { /* ignore */ }
  setLang(l, slug, false);
}

export function setLang(l: Lang, slug: string | null = null, save = true) {
  current = l;
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
  if (save && slug) { try { localStorage.setItem(`mfy:${slug}:lang`, l); } catch { /* ignore */ } }
  listeners.forEach((f) => f());
}

export function useLang(): Lang {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => current, () => current);
}

export function t(k: Key, lang: Lang = current): string {
  return S[k][lang === "ar" ? 0 : 1];
}

/** The Arabic or English of a field pair, falling back to Arabic. */
export function pick(lang: Lang, ar: string | null | undefined, en: string | null | undefined): string {
  return (lang === "en" && en ? en : ar) ?? "";
}
