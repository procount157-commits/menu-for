// ── What a member of staff may do ─────────────────────────────────
// The owner picks, per person, from a short list: a cashier gets the queue
// and the orders, a menu editor only the menu, a marketer only marketing —
// and «مدير كامل» is everything the owner can do in the shop. The server
// turns each permission into the routes it opens (api-server
// lib/tenancy/permissions.ts); everything else stays closed to staff.
//
// Staff made before permissions existed have none stored and keep exactly
// what their role gave them.

export const STAFF_PERMS = [
  "queue", "orders", "bookings", "menu", "customers", "reports", "settings", "chats", "marketing", "admin",
] as const;
export type StaffPerm = typeof STAFF_PERMS[number];

export const PERM_INFO: Record<StaffPerm, { label: string; hint: string }> = {
  queue:     { label: "الصف",              hint: "شاشة الصف: «التالي»، إضافة زبون، «ما حضر»" },
  orders:    { label: "الطلبات",           hint: "استقبال الطلبات وتغيير حالتها، و«خلص» للأصناف" },
  bookings:  { label: "الحجوزات",          hint: "الحجوزات والمواعيد وتأكيدها" },
  menu:      { label: "المنيو",            hint: "الأصناف والأسعار والصور والعروض" },
  customers: { label: "الزبائن",           hint: "قائمة الزبائن وزياراتهم" },
  reports:   { label: "التقارير",          hint: "أرقام اليوم والأسبوع" },
  settings:  { label: "إعدادات الصف والحجز", hint: "إعدادات الصف والمواعيد، وأكواد QR" },
  chats:     { label: "المحادثات",         hint: "محادثات واتساب وصندوق الوارد والرد على الزبائن" },
  marketing: { label: "التسويق",           hint: "الحملات والمتابعات وقوائم الأرقام وواتساب الآلي والبريد" },
  admin:     { label: "مدير كامل",         hint: "كل ما يقدر عليه صاحب المحل: الإعدادات والفروع والموظفين وربط واتساب" },
};

/** Ready-made sets the owner starts from, then adjusts. */
export const PERM_PRESETS: Array<{ id: string; label: string; perms: StaffPerm[] }> = [
  { id: "staff",     label: "كاشير / مضيف",   perms: ["queue", "orders", "bookings"] },
  { id: "manager",   label: "مدير فرع",       perms: ["queue", "orders", "bookings", "menu", "customers", "reports", "settings"] },
  { id: "menu",      label: "المنيو فقط",     perms: ["menu"] },
  { id: "marketing", label: "التسويق",        perms: ["marketing", "customers", "chats"] },
  { id: "admin",     label: "مدير كامل",      perms: ["admin"] },
];

/** The basic three: what a counter account does, and nothing that changes the shop. */
const COUNTER: readonly StaffPerm[] = ["queue", "orders", "bookings"];

/** What a role gave before permissions existed. */
export function permsForRole(role: string | null | undefined): StaffPerm[] {
  return role === "manager" ? [...PERM_PRESETS[1]!.perms] : [...COUNTER];
}

/** Pure: whatever was sent, as a clean list in catalogue order (admin alone if present). */
export function cleanPerms(raw: unknown): StaffPerm[] {
  const set = new Set(Array.isArray(raw) ? raw.map(String) : []);
  if (set.has("admin")) return ["admin"];
  return STAFF_PERMS.filter((p) => set.has(p));
}

/** A person's permissions: stored ones, or their role's for staff from before. */
export function permsOf(s: { permissions?: unknown; role?: string | null }): StaffPerm[] {
  return Array.isArray(s.permissions) ? cleanPerms(s.permissions) : permsForRole(s.role);
}

/**
 * The role a set of permissions works as: «مدير كامل» as the owner, anything
 * beyond the counter three as a manager, the counter three as staff. Which
 * routes they reach is decided by the permissions themselves.
 */
export function roleForPerms(perms: readonly StaffPerm[]): "owner" | "manager" | "staff" {
  if (perms.includes("admin")) return "owner";
  return perms.every((p) => COUNTER.includes(p)) ? "staff" : "manager";
}
