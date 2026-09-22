/**
 * Creates the first admin user.
 * Usage: pnpm --filter @workspace/scripts run seed-admin
 *
 * Set env vars before running:
 *   ADMIN_PHONE=971501234567 ADMIN_PASSWORD=yourpassword pnpm --filter @workspace/scripts run seed-admin
 */
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const phone = process.env["ADMIN_PHONE"];
const password = process.env["ADMIN_PASSWORD"];
const displayName = process.env["ADMIN_NAME"] || "المدير";

if (!phone || !password) {
  console.error("❌ يرجى تحديد ADMIN_PHONE و ADMIN_PASSWORD كمتغيرات بيئة");
  process.exit(1);
}

const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, "").replace(/^00/, "");

const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, cleanPhone));
if (existing.length > 0) {
  console.log(`✓ المدير موجود مسبقاً (${cleanPhone})`);
  process.exit(0);
}

const passwordHash = await bcrypt.hash(password, 10);
const [user] = await db.insert(usersTable).values({
  phone: cleanPhone,
  passwordHash,
  displayName,
  isAdmin: true,
  status: "active",
}).returning();

console.log(`✅ تم إنشاء المدير بنجاح!`);
console.log(`   رقم الهاتف: ${user.phone}`);
console.log(`   الاسم: ${user.displayName}`);
console.log(`   ID: ${user.id}`);

process.exit(0);
