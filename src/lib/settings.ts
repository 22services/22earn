import { db, type DB } from "@/db";
import { settings, type Settings } from "@/db/schema";

type Executor = Pick<DB, "select" | "insert">;

export async function getSettings(dbx: Executor = db): Promise<Settings> {
  const [row] = await dbx.select().from(settings).limit(1);
  if (row) return row;
  await dbx.insert(settings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await dbx.select().from(settings).limit(1);
  return created!;
}

export function parseReminderHours(value: string): number[] {
  return [...new Set(value.split(/[,\s]+/).map((h) => Number(h)).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort(
    (a, b) => a - b,
  );
}
