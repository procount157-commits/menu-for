// Give every demo account (seed-demo.ts) one new password of the owner's
// choosing — typed here, hidden, never stored anywhere but as a hash.
//
//   node --env-file=.env --import tsx artifacts/api-server/src/scripts/set-demo-password.ts
//
// Re-running seed-demo.ts puts the old password back.

import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import { db, usersTable, orgsTable, staffTable } from "@workspace/db";

const PHONES = ["500000000", "500000001", "500000002", "500000003", "500000004"];
const SLUGS = ["bait-shami", "alreem-sweets", "lamsa-salon", "alfaris-barber"];

// Piped in (no terminal): one line per question.
let lines: Promise<string[]> | null = null;
function piped(): Promise<string[]> {
  lines ??= new Promise((resolve) => { let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => resolve(s.split("\n").map((l) => l.trim()))); });
  return lines;
}

function ask(q: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    if (!stdin.isTTY) { process.stdout.write("\n"); piped().then((lines) => resolve(lines.shift() ?? "")); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let s = "";
    const on = (c: string) => {
      if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", on); process.stdout.write("\n"); resolve(s); }
      else if (c === "\u0003") process.exit(130);
      else if (c === "\u007f") { if (s) { s = s.slice(0, -1); process.stdout.write("\b \b"); } }
      else { s += c; process.stdout.write("•"); }
    };
    stdin.on("data", on);
  });
}

const pass = await ask("كلمة المرور الجديدة لكل الحسابات التجريبية: ");
if (pass.length < 6) { console.error("6 أحرف على الأقل."); process.exit(1); }
const again = await ask("أعد كتابتها: ");
if (again !== pass) { console.error("الكلمتان غير متطابقتين — لم يتغيّر شيء."); process.exit(1); }

const hash = await bcrypt.hash(pass, 10);
const users = await db.update(usersTable).set({ passwordHash: hash }).where(inArray(usersTable.phone, PHONES)).returning({ phone: usersTable.phone });
const orgs = await db.select({ id: orgsTable.id }).from(orgsTable).where(inArray(orgsTable.slug, SLUGS));
const staff = orgs.length
  ? await db.update(staffTable).set({ passwordHash: hash }).where(inArray(staffTable.orgId, orgs.map((o) => o.id))).returning({ username: staffTable.username })
  : [];
console.log(`✅ تغيّرت كلمة المرور: ${users.length} حساب أصحاب ومدير، و${staff.length} موظفين.`);
process.exit(0);
