/**
 * Applies SQL migrations from ./drizzle to the configured database.
 * Runs automatically before `npm run dev` and in the Docker entrypoint.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { closeDb, db, embeddedDatabaseDir, isEmbeddedDatabase } from "../src/db";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");

async function main() {
  if (isEmbeddedDatabase()) {
    fs.mkdirSync(path.dirname(embeddedDatabaseDir()), { recursive: true });
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
    console.log(`✔ migrations applied (embedded database: ${embeddedDatabaseDir()})`);
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder });
    console.log("✔ migrations applied (PostgreSQL)");
  }
}

main()
  .catch((err) => {
    console.error("✖ migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
