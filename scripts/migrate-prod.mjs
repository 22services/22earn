// Production migration runner (plain JS — no TypeScript tooling needed in the container).
// Uses MIGRATION_DATABASE_URL when set (e.g. a direct, non-pooled Neon/Supabase URL).
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("✖ DATABASE_URL must be a postgres:// URL in production.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  console.log("✔ database migrations applied");
} catch (err) {
  console.error("✖ migration failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
