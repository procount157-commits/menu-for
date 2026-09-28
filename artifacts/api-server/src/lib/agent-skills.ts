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

/**
 * "internal" is not a customer intent: it is what a meeting, a coaching
 * round or an alert asks for, and skills tagged with it never load for a
 * customer reply.
 */
export type SkillContext = Intent | "internal";

export async function skillsFor(
  userId: number, role: string, intent: SkillContext,
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

// Two skills decide how a reply reads rather than what it contains, and they
// belong at the end of the prompt rather than among the others. Named here so
// the split is one list to change, not a condition scattered across callers.
const WRITING_SKILLS = ["الكتابة البشرية", "مجاراة لهجة العميل"];

export const isWritingSkill = (s: AgentSkill) => WRITING_SKILLS.includes(s.name);

/** The skills, as prompt text. Named, because a persona may refer to one. */
export function skillsPreamble(skills: AgentSkill[]): string {
  const rest = skills.filter((s) => !isWritingSkill(s));
  if (rest.length === 0) return "";
  return ["مهارات تملكها:", ...rest.map((s) => `— ${s.name}: ${s.instruction.trim()}`)].join("\n");
}

/**
 * The writing rules, for the very end of the prompt.
 *
 * Framed as a check rather than as more instructions: by this point the model
 * has read two thousand words about the business and the customer, and what
 * moves the needle is a short list it reads immediately before writing.
 */
export function finalCheckPreamble(skills: AgentSkill[]): string {
  const writing = skills.filter(isWritingSkill);
  if (writing.length === 0) return "";
  return [
    "═══ قبل أن ترسل — راجع رسالتك على هذه ═══",
    ...writing.map((s) => s.instruction.trim()),
  ].join("\n\n");
}
