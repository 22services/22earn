/**
 * Create an admin, or reset an existing user's password and make them admin.
 *   npm run admin:create -- --email you@example.com --password 'a-strong-password' --name "Your Name"
 * Useful on a server when you lost access (alternative to the /setup page on an empty DB).
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { sessions, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const password = arg("password");
  const name = arg("name") ?? "Admin";
  if (!email || !password) throw new Error("Usage: npm run admin:create -- --email you@example.com --password '…' [--name 'Your Name']");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email));
  if (existing) {
    await db.update(users).set({ role: "admin", status: "active", passwordHash }).where(eq(users.id, existing.id));
    await db.delete(sessions).where(eq(sessions.userId, existing.id));
    console.log(`✔ ${email} is now an admin with the new password (all sessions signed out).`);
  } else {
    await db.insert(users).values({ email, name, role: "admin", status: "active", passwordHash });
    console.log(`✔ Admin ${email} created.`);
  }
}

main()
  .catch((err) => {
    console.error("✖", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
