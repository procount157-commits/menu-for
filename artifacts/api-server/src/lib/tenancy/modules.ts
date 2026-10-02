// ── The queue and bookings as switches ────────────────────────────
// Not every shop wants a queue or bookings — most restaurants want neither,
// a salon wants both. So each is a switch on the shop (`orgs.features.queue`,
// `orgs.features.booking`), and what a new shop starts with depends on its
// kind and is the super admin's to decide (`platform_settings.module_defaults`).
//
// A switch only narrows the plan: a shop whose plan has no queue has no queue
// whatever its switch says. A shop made before the switches existed has
// neither key set, and keeps what it had (on).

import { eq } from "drizzle-orm";
import { db, platformSettingsTable, orgsTable, branchesTable, bookingSettingsTable, type Org } from "@workspace/db";
import { VERTICALS, type Vertical } from "@workspace/menu-shared";

export const MODULES = ["queue", "booking"] as const;
export type Module = typeof MODULES[number];
export type ModuleSet = Record<Module, boolean>;
export type ModuleDefaults = Record<Vertical, ModuleSet>;

/** Used until the super admin saves their own. */
export const BUILT_IN_DEFAULTS: ModuleDefaults = Object.fromEntries(
  VERTICALS.map((v) => [v, v === "beauty" || v === "barber" ? { queue: true, booking: true } : { queue: false, booking: false }]),
) as ModuleDefaults;

const KEY = "module_defaults";

/** Pure: a stored value, whatever shape it is in, as a complete set of defaults. */
export function cleanDefaults(raw: unknown): ModuleDefaults {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Partial<ModuleSet> | undefined>;
  return Object.fromEntries(VERTICALS.map((v) => [v, Object.fromEntries(MODULES.map((m) => {
    const x = r[v]?.[m];
    return [m, typeof x === "boolean" ? x : BUILT_IN_DEFAULTS[v][m]];
  }))])) as ModuleDefaults;
}

export async function moduleDefaults(): Promise<ModuleDefaults> {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, KEY)).limit(1);
  return cleanDefaults(row?.value);
}

export async function saveModuleDefaults(patch: unknown): Promise<ModuleDefaults> {
  const current = await moduleDefaults();
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, Partial<ModuleSet>>;
  const next = cleanDefaults(Object.fromEntries(VERTICALS.map((v) => [v, { ...current[v], ...(p[v] ?? {}) }])));
  await db.insert(platformSettingsTable).values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

/** What a new shop of this kind starts with. */
export async function defaultsFor(vertical: string): Promise<ModuleSet> {
  const d = await moduleDefaults();
  return d[(VERTICALS as readonly string[]).includes(vertical) ? vertical as Vertical : "restaurant"];
}

/** Pure: the shop's own switches. Unset = on (shops from before the switches). */
export function orgModules(org: Pick<Org, "features"> | null | undefined): ModuleSet {
  const f = org?.features ?? {};
  return { queue: f["queue"] !== false, booking: f["booking"] !== false };
}

/**
 * Set a shop's switches. Turning bookings on opens them on every branch — a
 * restaurant that asked for bookings should not then hunt for a second switch;
 * a branch can still close its own from its booking settings.
 */
export async function setOrgModules(org: Org, patch: Partial<ModuleSet>): Promise<Org> {
  const f = { ...(org.features ?? {}) };
  for (const m of MODULES) if (typeof patch[m] === "boolean") f[m] = patch[m]!;
  const [o] = await db.update(orgsTable).set({ features: f }).where(eq(orgsTable.id, org.id)).returning();
  if (patch.booking === true) {
    const branches = await db.select({ id: branchesTable.id }).from(branchesTable).where(eq(branchesTable.orgId, org.id));
    if (branches.length) {
      await db.insert(bookingSettingsTable).values(branches.map((b) => ({ branchId: b.id, enabled: true })))
        .onConflictDoUpdate({ target: bookingSettingsTable.branchId, set: { enabled: true, updatedAt: new Date() } });
    }
  }
  return o!;
}
