// ── The skill library ─────────────────────────────────────────────
// Skills live in source rather than being typed into the database once,
// because they are the expertise this system sells and they should be
// reviewable in a diff. `seedSkills` installs them and is safe to re-run: it
// updates the text of a skill the owner has not edited, and never touches one
// they have.
//
// Every skill here is written as a procedure with literal wording. That is the
// design constraint the owner set — it has to work when the model answering is
// whatever free tier is up today. A weak model following an explicit table
// outperforms a strong model asked to be expert, and the difference widens as
// the model gets weaker.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, agentSkillsTable, agentSkillGrantsTable, botEmployeesTable } from "@workspace/db";
import { DIALECT_SKILL, INTENT_READING_SKILL } from "./dialect";
import { NEGOTIATION_SKILL, DISCOVERY_SKILL, COMPLAINT_SKILL } from "./selling";
import { FOLLOWUP_WRITING_SKILL, ANALYSIS_SKILL, COACHING_SKILL, SALES_MANAGEMENT_SKILL } from "./internal";
import { HUMAN_WRITING_SKILL, DIALECT_MATCH_SKILL } from "./writing";
import { logger } from "../logger";

export type SkillDef = { name: string; intents: string[]; instruction: string };

export const LIBRARY: SkillDef[] = [
  HUMAN_WRITING_SKILL, DIALECT_MATCH_SKILL,
  DIALECT_SKILL, INTENT_READING_SKILL,
  NEGOTIATION_SKILL, DISCOVERY_SKILL, COMPLAINT_SKILL,
  FOLLOWUP_WRITING_SKILL, ANALYSIS_SKILL, COACHING_SKILL, SALES_MANAGEMENT_SKILL,
];

/**
 * Who holds what.
 *
 * The two dialect skills go to everyone who writes to a customer, because
 * sounding foreign costs the same whoever is speaking. The rest are matched to
 * the job: سام gets de-escalation and not negotiation, because a support agent
 * who negotiates during a complaint makes it worse.
 */
// Everyone who writes to a customer carries the same two writing skills. How
// long a message is and whose dialect it is in are not role-specific, and the
// owner's complaint — that the replies read as a bot — was about exactly these.
const WRITES_TO_CUSTOMERS = [
  HUMAN_WRITING_SKILL.name, DIALECT_MATCH_SKILL.name,
  DIALECT_SKILL.name, INTENT_READING_SKILL.name,
];

export const GRANTS: Record<string, string[]> = {
  sales:     [...WRITES_TO_CUSTOMERS, NEGOTIATION_SKILL.name, DISCOVERY_SKILL.name],
  support:   [...WRITES_TO_CUSTOMERS, COMPLAINT_SKILL.name],
  // The manager answers customers when nobody else fits, and coaches the rest
  // of the time — so she carries both sides.
  chief:     [...WRITES_TO_CUSTOMERS, NEGOTIATION_SKILL.name, DISCOVERY_SKILL.name,
              COACHING_SKILL.name, ANALYSIS_SKILL.name, SALES_MANAGEMENT_SKILL.name],
  followup:  [...WRITES_TO_CUSTOMERS, FOLLOWUP_WRITING_SKILL.name],
  collector: [ANALYSIS_SKILL.name],
  intake:    [ANALYSIS_SKILL.name],
};

export type SeedResult = { created: number; updated: number; untouched: number; granted: number };

export async function seedSkills(userId: number): Promise<SeedResult> {
  const r: SeedResult = { created: 0, updated: 0, untouched: 0, granted: 0 };

  const existing = await db.select().from(agentSkillsTable).where(eq(agentSkillsTable.userId, userId));
  const byName = new Map(existing.map((s) => [s.name, s]));
  const known = new Map(LIBRARY.map((s) => [s.name, s]));

  for (const def of LIBRARY) {
    const ex = byName.get(def.name);
    if (!ex) {
      const [row] = await db.insert(agentSkillsTable)
        .values({ userId, name: def.name, instruction: def.instruction, intents: def.intents })
        .returning();
      byName.set(def.name, row!);
      r.created++;
      continue;
    }
    // An instruction the owner has rewritten is theirs. Only a copy that still
    // matches some version of the library gets refreshed — otherwise every
    // deploy would silently undo their edits.
    const libraryText = known.get(ex.name)?.instruction;
    if (ex.instruction === libraryText) { r.untouched++; continue; }

    const ownerEdited = !existing.some((e) => e.id === ex.id && e.instruction === libraryText);
    if (ownerEdited && ex.updatedAt && ex.createdAt &&
        new Date(ex.updatedAt).getTime() - new Date(ex.createdAt).getTime() > 1_000) {
      r.untouched++;
      continue;
    }
    await db.update(agentSkillsTable)
      .set({ instruction: def.instruction, intents: def.intents, updatedAt: new Date() })
      .where(eq(agentSkillsTable.id, ex.id));
    r.updated++;
  }

  // Grants are not owner data in the same way — they follow from the roster —
  // but an explicitly revoked grant should stay revoked, so only missing ones
  // are added.
  const roster = await db.select({ role: botEmployeesTable.role }).from(botEmployeesTable)
    .where(eq(botEmployeesTable.userId, userId));
  const held = await db.select().from(agentSkillGrantsTable).where(eq(agentSkillGrantsTable.userId, userId));

  for (const { role } of roster) {
    for (const skillName of GRANTS[role] ?? []) {
      const skill = byName.get(skillName);
      if (!skill) continue;
      if (held.some((g) => g.role === role && g.skillId === skill.id)) continue;
      await db.insert(agentSkillGrantsTable)
        .values({ userId, role, skillId: skill.id }).onConflictDoNothing();
      r.granted++;
    }
  }

  logger.info({ userId, ...r }, "مكتبة المهارات مُثبّتة");
  return r;
}

/** Restore one skill to the library text, discarding an edit. */
export async function resetSkill(userId: number, name: string): Promise<boolean> {
  const def = LIBRARY.find((s) => s.name === name);
  if (!def) return false;
  const res = await db.update(agentSkillsTable)
    .set({ instruction: def.instruction, intents: def.intents, updatedAt: new Date() })
    .where(and(eq(agentSkillsTable.userId, userId), eq(agentSkillsTable.name, name)))
    .returning();
  return res.length > 0;
}
