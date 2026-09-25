// ── Reusable instruction sets ─────────────────────────────────────
// A skill is written once and held by whoever needs it. "How to handle a price
// objection" belongs to sales and to collections both, and the alternative —
// the same three paragraphs pasted into two personas — drifts apart the first
// time one of them is edited.
//
// Skills carry intents so a long instruction set is not pasted into every
// reply. An empty list means the holder always carries it.

import { and, eq, inArray } from "drizzle-orm";
import { db, agentSkillsTable, agentSkillGrantsTable, type AgentSkill } from "@workspace/db";
import type { Intent } from "./intent";

export async function skillsFor(
  userId: number, role: string, intent: Intent,
): Promise<AgentSkill[]> {
  const grants = await db.select({ skillId: agentSkillGrantsTable.skillId })
    .from(agentSkillGrantsTable)
    .where(and(eq(agentSkillGrantsTable.userId, userId), eq(agentSkillGrantsTable.role, role)));
  if (grants.length === 0) return [];

  const rows = await db.select().from(agentSkillsTable)
    .where(and(
      eq(agentSkillsTable.userId, userId),
      eq(agentSkillsTable.isActive, true),
      inArray(agentSkillsTable.id, grants.map((g) => g.skillId)),
    ));

  return rows.filter((s) => {
    const want = Array.isArray(s.intents) ? s.intents as string[] : [];
    return want.length === 0 || want.includes(intent);
  });
}

/** The skills, as prompt text. Named, because a persona may refer to one. */
export function skillsPreamble(skills: AgentSkill[]): string {
  if (skills.length === 0) return "";
  return ["مهارات تملكها:", ...skills.map((s) => `— ${s.name}: ${s.instruction.trim()}`)].join("\n");
}
