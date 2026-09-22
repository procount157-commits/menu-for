/**
 * Chatbot engine — processes incoming WhatsApp messages and routes to flow nodes.
 * Handles: keyword matching, conversation state, opt-out (STOP).
 */
import { db, chatbotsTable, contactsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

// ── In-memory conversation state ──────────────────────────────────
// Key: `${userId}:${phone}` → nodeId of last response, or "welcomed"
const convState = new Map<string, string>();

// ── Types ─────────────────────────────────────────────────────────
type BotNode = {
  id: string;
  label?: string;
  keywords: string;       // comma-separated trigger keywords
  message: string;
  mediaType?: string;
  mediaUrl?: string;
  options: { text: string; keyword?: string; nodeId: string }[];
  x?: number; y?: number;
};

type SendFn = (
  phone: string,
  msg: string,
  type?: string,
  mediaUrl?: string | null
) => Promise<void | string | undefined>;

// ── Keywords that trigger opt-out ─────────────────────────────────
const STOP_WORDS = new Set([
  "0", "stop", "توقف", "ايقاف", "إيقاف", "وقف",
  "انهاء", "إنهاء", "لا", "unsubscribe", "quit", "off",
]);

// ── Main entry point ──────────────────────────────────────────────

export async function processChatbotMessage(
  userId: number,
  fromPhone: string,
  rawText: string,
  sendFn: SendFn
): Promise<void> {
  const text = rawText.trim();
  const normalized = text.toLowerCase();

  // Opt-out check first
  if (STOP_WORDS.has(normalized)) {
    await handleOptOut(userId, fromPhone, sendFn);
    return;
  }

  // Find the user's enabled chatbot
  const [bot] = await db
    .select()
    .from(chatbotsTable)
    .where(and(eq(chatbotsTable.userId, userId), eq(chatbotsTable.enabled, true)));

  if (!bot) return;

  let nodes: BotNode[] = [];
  try { nodes = JSON.parse(bot.nodes); } catch { nodes = []; }

  const stateKey = `${userId}:${fromPhone}`;
  const currentState = convState.get(stateKey);

  // ── First contact → welcome ──────────────────────────────────
  if (!currentState) {
    convState.set(stateKey, "welcomed");
    await sendFn(fromPhone, bot.welcomeMessage);
    return;
  }

  // ── Try keyword match ────────────────────────────────────────
  const matched = matchNode(nodes, normalized, currentState);

  if (matched) {
    convState.set(stateKey, matched.id);
    const msgType = matched.mediaUrl
      ? (matched.mediaType === "video" ? "video" : "image")
      : "text";
    await sendFn(fromPhone, matched.message, msgType, matched.mediaUrl || null);
    return;
  }

  // ── No match: resend welcome ─────────────────────────────────
  if (currentState === "welcomed") {
    await sendFn(fromPhone, bot.welcomeMessage);
  }
}

// ── Keyword matching ──────────────────────────────────────────────

function matchNode(nodes: BotNode[], text: string, currentState: string): BotNode | null {
  // Current node's children options first (priority to current flow branch)
  if (currentState !== "welcomed") {
    const current = nodes.find((n) => n.id === currentState);
    if (current) {
      for (const opt of current.options) {
        const kw = (opt.keyword || opt.text || "").toLowerCase().trim();
        if (kw && (text === kw || text.includes(kw))) {
          const child = nodes.find((n) => n.id === opt.nodeId);
          if (child) return child;
        }
      }
    }
  }

  // Global keyword search across all nodes
  for (const node of nodes) {
    const kwList = node.keywords
      .split(/[,،]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (kwList.some((k) => text === k || text.includes(k))) return node;
  }

  // Number shortcut: "1" matches first node, "2" second, etc.
  const num = parseInt(text);
  if (!isNaN(num) && num >= 1 && num <= nodes.length) {
    return nodes[num - 1];
  }

  return null;
}

// ── Opt-out handler ───────────────────────────────────────────────

async function handleOptOut(
  userId: number,
  phone: string,
  sendFn: SendFn
): Promise<void> {
  try {
    // Remove the contact from all groups belonging to this user
    // Join on contactsTable.groupId → contactGroupsTable.userId
    const { contactGroupsTable } = await import("@workspace/db");
    const userGroups = await db
      .select({ id: contactGroupsTable.id })
      .from(contactGroupsTable)
      .where(eq(contactGroupsTable.userId, userId));

    for (const g of userGroups) {
      await db
        .delete(contactsTable)
        .where(and(eq(contactsTable.groupId, g.id), eq(contactsTable.phone, phone)));
    }

    convState.delete(`${userId}:${phone}`);
    await sendFn(phone, "تم إلغاء اشتراكك بنجاح ✅\n\nلن تصلك رسائل أخرى منا.\nإذا أردت العودة تواصل معنا مجدداً.");
    logger.info({ userId, phone }, "Opt-out: contact removed from all groups");
  } catch (err) {
    logger.error({ err, userId, phone }, "Opt-out handler error");
  }
}

// ── Clear conversation state for a user (on disconnect/logout) ────

export function clearUserConversations(userId: number): void {
  const prefix = `${userId}:`;
  for (const key of convState.keys()) {
    if (key.startsWith(prefix)) convState.delete(key);
  }
}
