// ── First-connection setup ────────────────────────────────────────
// Runs the first time an account links WhatsApp, so a new user lands on a
// system that is already wired rather than a set of empty pages.
//
// What it does NOT do is switch the customer-facing bot on. Auto-reply with an
// empty knowledge base answers nothing anyway, and turning it on for someone
// who has not written a word of it is a decision that belongs to them.

import { and, eq, sql } from "drizzle-orm";
import {
  db, businessProfileTable, followUpSequencesTable, usersTable,
  DEFAULT_FOLLOW_UP_STEPS,
} from "@workspace/db";
import { logger } from "./logger";

export async function provisionOnConnect(userId: number): Promise<void> {
  try {
    // Profile row: settings have somewhere to live, auto-reply off.
    const [profile] = await db.select().from(businessProfileTable)
      .where(eq(businessProfileTable.userId, userId));

    if (!profile) {
      const [user] = await db.select({ name: usersTable.displayName })
        .from(usersTable).where(eq(usersTable.id, userId));
      await db.insert(businessProfileTable)
        .values({ userId, name: user?.name ?? null, tone: "friendly", autoReply: false })
        .onConflictDoNothing();
      logger.info({ userId }, "provisioned business profile on first connect");
    }

    // A follow-up sequence, ready but idle. Building one from nothing is the
    // step most people never get to; reviewing one and pressing play is not.
    const [existing] = await db.select({ n: sql<number>`count(*)` })
      .from(followUpSequencesTable).where(eq(followUpSequencesTable.userId, userId));

    if (Number(existing?.n ?? 0) === 0) {
      await db.insert(followUpSequencesTable).values({
        userId,
        name: "متابعة العملاء (جاهزة — فعّلها متى شئت)",
        isActive: false,
        sourceFilter: "all",
        stopOnReply: true,
        steps: [...DEFAULT_FOLLOW_UP_STEPS] as any,
      });
      logger.info({ userId }, "provisioned default follow-up sequence (inactive)");
    }
  } catch (err) {
    // Never let setup failure affect the connection itself.
    logger.warn({ err, userId }, "provisioning on connect failed");
  }
}
