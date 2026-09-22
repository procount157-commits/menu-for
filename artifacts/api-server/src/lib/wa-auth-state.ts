/**
 * useDatabaseAuthState — Baileys auth state backed by PostgreSQL.
 *
 * WHY: The filesystem (`whatsapp-session/`) is ephemeral in Replit deployments.
 * Every new deployment spins up a fresh container with no session files, forcing
 * the user to re-scan a QR code.  PostgreSQL persists across all deployments and
 * restarts, so the session survives forever until the user explicitly logs out.
 *
 * DROP-IN replacement for Baileys' useMultiFileAuthState().
 */

import { and, eq } from "drizzle-orm";
import { db, waAuthStateTable } from "@workspace/db";
import { logger as appLogger } from "./logger";

// All of these ARE re-exported from the main Baileys entry point:
//   - proto        ← via  export * from '../WAProto/index.js'
//   - BufferJSON   ← via  export * from './Utils/generics.js'
//   - initAuthCreds ← via export * from './Utils/auth-utils.js'
import {
  proto,
  initAuthCreds,
  BufferJSON,
} from "@whiskeysockets/baileys";
import type { AuthenticationCreds, AuthenticationState } from "@whiskeysockets/baileys";

// ─────────────────────────────────────────────────────────────────────────────

const log = appLogger.child({ module: "wa-auth-state" });

// Transient PG error patterns (same as campaigns.ts)
const DB_TRANSIENT = /connection terminated|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|connection refused|too many clients/i;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message ?? err?.cause?.message ?? "");
      if (!DB_TRANSIENT.test(msg)) throw err; // non-transient — propagate immediately
      lastErr = err;
      const delay = Math.min(3_000 * Math.pow(2, i), 30_000);
      log.warn({ label, attempt: i + 1, delay }, "DB transient error — retrying auth-state op");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function useDatabaseAuthState(userId: number): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // Load all keys for this user into an in-memory map for fast reads
  const rows = await db
    .select()
    .from(waAuthStateTable)
    .where(eq(waAuthStateTable.userId, userId));

  const cache = new Map<string, string>(rows.map((r) => [r.key, r.value]));

  // ── helpers ────────────────────────────────────────────────────────────────

  function deserialise(raw: string | undefined) {
    if (!raw) return null;
    try { return JSON.parse(raw, BufferJSON.reviver); } catch { return null; }
  }

  function serialise(value: unknown): string {
    return JSON.stringify(value, BufferJSON.replacer);
  }

  async function writeKey(key: string, value: unknown) {
    const serialised = serialise(value);
    cache.set(key, serialised); // always update in-memory first
    await withRetry(
      () => db
        .insert(waAuthStateTable)
        .values({ userId, key, value: serialised })
        .onConflictDoUpdate({
          target: [waAuthStateTable.userId, waAuthStateTable.key],
          set: { value: serialised },
        }),
      `writeKey:${key}`,
    );
  }

  async function removeKey(key: string) {
    cache.delete(key);
    await withRetry(
      () => db
        .delete(waAuthStateTable)
        .where(
          and(
            eq(waAuthStateTable.userId, userId),
            eq(waAuthStateTable.key, key),
          ),
        ),
      `removeKey:${key}`,
    );
  }

  // ── credentials ────────────────────────────────────────────────────────────

  const creds: AuthenticationCreds =
    deserialise(cache.get("creds.json")) ?? initAuthCreds();

  // ── auth state object ───────────────────────────────────────────────────────

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, unknown> = {};
        await Promise.all(
          ids.map(async (id: string) => {
            const key = `${type}-${id}.json`;
            let value = deserialise(cache.get(key));
            if (value == null) {
              // Cache miss — try DB (shouldn't normally happen after initial load)
              const row = await db
                .select()
                .from(waAuthStateTable)
                .where(
                  and(
                    eq(waAuthStateTable.userId, userId),
                    eq(waAuthStateTable.key, key),
                  ),
                )
                .then((r) => r[0]);
              if (row) {
                cache.set(key, row.value);
                value = deserialise(row.value);
              }
            }
            // Baileys requires app-state-sync-key values to be proto objects
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }),
        );
        return result as any;
      },

      set: async (data: Record<string, Record<string, unknown> | null | undefined>) => {
        const tasks: Promise<void>[] = [];
        for (const category in data) {
          for (const id in (data as any)[category]) {
            const value = (data as any)[category][id];
            const key   = `${category}-${id}.json`;
            tasks.push(value ? writeKey(key, value) : removeKey(key));
          }
        }
        await Promise.all(tasks);
      },
    } as any,
  };

  return {
    state,
    saveCreds: () => writeKey("creds.json", creds),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-time migration: if a user has session files on disk but nothing in the DB
 * (e.g. upgrading from the file-based approach), import them into the DB now.
 */
export async function migrateSessionFilesToDb(
  userId: number,
  sessionDir: string,
): Promise<void> {
  const fs   = await import("fs");
  const path = await import("path");

  if (!fs.existsSync(sessionDir)) return;

  // Check if DB already has creds for this user — if so, skip migration
  const existing = await db
    .select()
    .from(waAuthStateTable)
    .where(
      and(
        eq(waAuthStateTable.userId, userId),
        eq(waAuthStateTable.key, "creds.json"),
      ),
    )
    .then((r) => r[0]);

  if (existing) return; // already in DB

  const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".json"));
  if (files.length === 0) return;

  log.info({ userId, fileCount: files.length }, "Migrating session files to DB");

  const values = files.map((file: string) => ({
    userId,
    key:   file,
    value: fs.readFileSync(path.join(sessionDir, file), "utf-8"),
  }));

  await db
    .insert(waAuthStateTable)
    .values(values)
    .onConflictDoNothing();

  log.info({ userId }, "Session files migrated to DB");
}
