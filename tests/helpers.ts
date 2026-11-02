import path from "node:path";
import { eq } from "drizzle-orm";
import { db, isEmbeddedDatabase } from "@/db";
import { campaignMembers, campaigns, posts, settings, socialAccounts, users } from "@/db/schema";
import { getSettings } from "@/lib/settings";

export async function migrateTestDb() {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  if (isEmbeddedDatabase()) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder });
  }
  await getSettings();
}

export async function setHoldHours(hours: number, minPayoutCents = 1000) {
  await db.update(settings).set({ holdHours: hours, minPayoutCents }).where(eq(settings.id, 1));
}

const run = Math.random().toString(36).slice(2, 8);
let n = 0;
export async function makeWorld(opts: { cpmCents?: number; flatFeeCents?: number; maxPerPostCents?: number | null } = {}) {
  n++;
  const [admin] = await db.insert(users).values({ email: `admin${n}.${run}@test.dev`, name: "Admin", role: "admin", status: "active" }).returning();
  const [influencer] = await db
    .insert(users)
    .values({ email: `alex${n}.${run}@test.dev`, name: "Alex", role: "influencer", status: "active", paypalEmail: `alex${n}.${run}@paypal.test`, payoutMethod: "paypal" })
    .returning();
  const [campaign] = await db
    .insert(campaigns)
    .values({ name: "Summer Clips", cpmCents: opts.cpmCents ?? 150, flatFeeCents: opts.flatFeeCents ?? 500, maxPerPostCents: opts.maxPerPostCents ?? null })
    .returning();
  await db.insert(campaignMembers).values({ campaignId: campaign!.id, userId: influencer!.id });
  const [account] = await db
    .insert(socialAccounts)
    .values({ userId: influencer!.id, platform: "tiktok", handle: `alex.clips${n}.${run}`, followers: 48200, goalPerDay: 2 })
    .returning();
  return { admin: admin!, influencer: influencer!, campaign: campaign!, account: account! };
}

export async function makePost(world: Awaited<ReturnType<typeof makeWorld>>, url: string) {
  const [post] = await db
    .insert(posts)
    .values({ userId: world.influencer.id, socialAccountId: world.account.id, campaignId: world.campaign.id, url })
    .returning();
  return post!;
}
