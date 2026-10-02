// ── Telling the shop ──────────────────────────────────────────────
// A new order or booking should reach the owner's own phone, not wait for
// someone to look at the dashboard. Sent from the shop's linked number to the
// phones listed on the branch (the staff lane: no customer checks, paced like
// everything else).

import { eq } from "drizzle-orm";
import { db, branchesTable, orgsTable, type Branch, type Org } from "@workspace/db";
import { enqueue } from "./outbox";
import { publicUrl } from "../menu/urls";

type AlertKind = "alert_order" | "alert_booking" | "alert_rating" | "alert_campaign";

export async function alertShop(org: Pick<Org, "id" | "ownerUserId">, branch: Pick<Branch, "waUserId" | "alertPhones">, kind: AlertKind, text: string, ref?: { type: "order" | "booking" | "customer"; id?: number }) {
  const phones = (branch.alertPhones ?? []).filter((p) => /^\d{8,15}$/.test(p));
  for (const phone of phones) {
    await enqueue({ org, waUserId: branch.waUserId, phone, kind, text, staff: true, refType: ref?.type, refId: ref?.id });
  }
  return phones.length;
}

export async function alertBranch(branchId: number, kind: AlertKind, text: string, ref?: { type: "order" | "booking" | "customer"; id?: number }) {
  const rows = await db.select({ b: branchesTable, o: orgsTable }).from(branchesTable)
    .innerJoin(orgsTable, eq(orgsTable.id, branchesTable.orgId)).where(eq(branchesTable.id, branchId)).limit(1);
  if (!rows[0]) return 0;
  return alertShop(rows[0].o, rows[0].b, kind, text, ref);
}

export const dashboardUrl = (path: string) => publicUrl(path);

/** Digits only, international form; drops anything that is not a phone. */
export function cleanAlertPhones(input: unknown): string[] {
  const list = Array.isArray(input) ? input : String(input ?? "").split(/[\s,،;]+/);
  const out = new Set<string>();
  for (const raw of list) {
    let d = String(raw ?? "").replace(/\D/g, "").replace(/^00/, "");
    if (d.startsWith("05") && d.length === 10) d = `971${d.slice(1)}`;
    if (/^\d{8,15}$/.test(d)) out.add(d);
  }
  return [...out].slice(0, 5);
}
