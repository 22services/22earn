import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One database API, two engines:
 *  - DATABASE_URL=postgres://…  → real PostgreSQL (production, Docker, Vercel/Neon…)
 *  - DATABASE_URL unset          → embedded PostgreSQL (PGlite) stored in ./.data/pglite,
 *                                   so `npm run dev` works on any PC with zero setup.
 * Both speak the same SQL dialect, so the schema and migrations are shared.
 */
export type DB = PostgresJsDatabase<typeof schema>;

export function isEmbeddedDatabase() {
  return !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? "");
}

export function embeddedDatabaseDir() {
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  return dir.startsWith("memory://") ? dir : path.resolve(/*turbopackIgnore: true*/ process.cwd(), dir);
}

type Holder = { db?: DB; pglite?: PGlite; sql?: postgres.Sql };
const holder = ((globalThis as unknown as { __22earnDb?: Holder }).__22earnDb ??= {});

function connect(): DB {
  if (holder.db) return holder.db;
  if (isEmbeddedDatabase()) {
    holder.pglite = new PGlite(embeddedDatabaseDir());
    holder.db = drizzlePglite(holder.pglite, { schema }) as unknown as DB;
  } else {
    holder.sql = postgres(process.env.DATABASE_URL!, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 20,
      // Serverless poolers (Neon/Supabase pgbouncer, port 6543) don't support prepared statements.
      prepare: process.env.DATABASE_PREPARE !== "false",
    });
    holder.db = drizzlePostgres(holder.sql, { schema });
  }
  return holder.db;
}

/**
 * Lazily connected — importing this module never opens a connection, which keeps
 * `next build` (multiple workers) from touching the database.
 */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = connect();
    const value = Reflect.get(real as object, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export async function closeDb() {
  await holder.pglite?.close();
  await holder.sql?.end({ timeout: 5 });
  holder.db = undefined;
  holder.pglite = undefined;
  holder.sql = undefined;
}

export { schema };
