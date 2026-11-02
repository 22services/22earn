/**
 * Demo data so you can click around immediately:
 *   npm run db:seed
 *
 * Creates an admin, three creators (one mirrors the reference screenshot: @alex.clips,
 * @alex.reels, @AlexClipsFR), a "Summer Clips" campaign, ~5 weeks of videos, earnings and
 * weekly payouts. Refuses to run if the database already has users.
 */
import "dotenv/config";
import { count, eq, inArray, and, isNull, lte } from "drizzle-orm";
import { closeDb, db } from "../src/db";
import { campaignMembers, campaigns, earnings, notifications, payouts, posts, socialAccounts, users, type Platform } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { env } from "../src/lib/env";
import { reconcilePostEarnings } from "../src/lib/ledger";
import { getSettings } from "../src/lib/settings";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@22earn.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
const CREATOR_PASSWORD = process.env.SEED_CREATOR_PASSWORD ?? "creator12345";

// deterministic randomness
let seed = 2207;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => Math.floor(a + rand() * (b - a + 1));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function main() {
  const [existing] = await db.select({ n: count() }).from(users);
  if ((existing?.n ?? 0) > 0) {
    console.log("✖ The database already has users — seed skipped. (Delete .data/ to start over with the embedded DB.)");
    return;
  }
  const settings = await getSettings();
  const now = new Date();

  const [admin] = await db
    .insert(users)
    .values({ name: "Owner", email: ADMIN_EMAIL, role: "admin", status: "active", passwordHash: await hashPassword(ADMIN_PASSWORD), timezone: "Europe/Paris" })
    .returning();

  const [summer] = await db
    .insert(campaigns)
    .values({
      name: "Summer Clips",
      description: "Short clips (15–45 s) from the summer podcast episodes. Hook in the first 2 seconds, captions on, #summerclips.",
      cpmCents: 150,
      flatFeeCents: 300,
      maxPerPostCents: 25_000,
    })
    .returning();
  const [launch] = await db
    .insert(campaigns)
    .values({ name: "App Launch", description: "Show the app in action. 1 video per day max per account.", cpmCents: 100, flatFeeCents: 500 })
    .returning();

  const creatorPassword = await hashPassword(CREATOR_PASSWORD);
  const creators = [
    {
      name: "Alex Martin",
      email: "alex@22earn.local",
      timezone: "Europe/Paris",
      diligence: 0.85,
      payout: { payoutMethod: "paypal" as const, paypalEmail: "alex@paypal.test" },
      campaigns: [summer!.id, launch!.id],
      accounts: [
        { platform: "tiktok" as Platform, handle: "alex.clips", followers: 48_200, goalPerDay: 2 },
        { platform: "instagram" as Platform, handle: "alex.reels", followers: 12_400, goalPerDay: 1 },
        { platform: "youtube" as Platform, handle: "alexclipsfr", followers: 3_900, goalPerDay: 1 },
      ],
    },
    {
      name: "Sofia Reyes",
      email: "sofia@22earn.local",
      timezone: "America/New_York",
      diligence: 0.65,
      payout: { payoutMethod: "stripe" as const, stripeAccountId: "acct_seed_sofia", stripeReady: true, stripeCountry: "US" },
      campaigns: [summer!.id],
      accounts: [
        { platform: "tiktok" as Platform, handle: "sofia.cuts", followers: 126_000, goalPerDay: 2 },
        { platform: "instagram" as Platform, handle: "sofiareyes", followers: 31_500, goalPerDay: 1 },
      ],
    },
    {
      name: "Malik Diallo",
      email: "malik@22earn.local",
      timezone: "Africa/Dakar",
      diligence: 0.4,
      payout: {},
      campaigns: [summer!.id],
      accounts: [{ platform: "tiktok" as Platform, handle: "malik.edits", followers: 8_700, goalPerDay: 2 }],
    },
  ];

  for (const c of creators) {
    const [user] = await db
      .insert(users)
      .values({ name: c.name, email: c.email, role: "influencer", status: "active", passwordHash: creatorPassword, timezone: c.timezone, ...c.payout })
      .returning();
    await db.insert(campaignMembers).values(c.campaigns.map((campaignId) => ({ campaignId, userId: user!.id })));
    const accounts = await db
      .insert(socialAccounts)
      .values(c.accounts.map((a) => ({ ...a, userId: user!.id })))
      .returning();

    // ~5 weeks of posting history
    for (let d = 34; d >= 0; d--) {
      for (const account of accounts) {
        for (let k = 0; k < account.goalPerDay + 1; k++) {
          const chance = k < account.goalPerDay ? c.diligence : c.diligence * 0.25;
          if (d === 0 && k > 0) continue; // today: at most one so far
          if (rand() > chance) continue;
          const createdAt = new Date(now.getTime() - d * DAY - between(1, 10) * HOUR);
          const campaignId = c.campaigns[between(0, c.campaigns.length - 1)]!;
          const campaign = campaignId === summer!.id ? summer! : launch!;
          const views = d === 0 ? 0 : Math.round(account.followers * (0.05 + rand() * (rand() < 0.08 ? 6 : 0.9)));
          const approved = d >= 1;
          const [post] = await db
            .insert(posts)
            .values({
              userId: user!.id,
              socialAccountId: account.id,
              campaignId,
              url: `https://www.${account.platform === "youtube" ? "youtube.com/shorts" : account.platform === "tiktok" ? `tiktok.com/@${account.handle}/video` : "instagram.com/reel"}/${Math.floor(rand() * 1e15)}`,
              status: approved ? "approved" : "pending",
              views,
              viewsUpdatedAt: approved ? new Date(createdAt.getTime() + DAY) : null,
              rateCpmCents: approved ? campaign.cpmCents : null,
              rateFlatFeeCents: approved ? campaign.flatFeeCents : null,
              rateMaxCents: approved ? campaign.maxPerPostCents : null,
              reviewedAt: approved ? new Date(createdAt.getTime() + 3 * HOUR) : null,
              reviewedById: approved ? admin!.id : null,
              createdAt,
            })
            .returning();
          if (approved) {
            await db.transaction((tx) => reconcilePostEarnings(tx, post!.id, admin!.id));
            const bookedAt = new Date(Math.min(createdAt.getTime() + 20 * HOUR, now.getTime() - HOUR));
            await db
              .update(earnings)
              .set({ createdAt: bookedAt, maturesAt: new Date(bookedAt.getTime() + settings.holdHours * HOUR) })
              .where(eq(earnings.postId, post!.id));
          }
        }
      }
    }

    // a bonus, to show manual earnings
    await db.insert(earnings).values({
      userId: user!.id,
      campaignId: summer!.id,
      kind: "bonus",
      amountCents: 2_000,
      note: "Top 3 creator of the week 🏆",
      maturesAt: new Date(now.getTime() - 9 * DAY),
      createdAt: new Date(now.getTime() - 9 * DAY),
      createdById: admin!.id,
    });

    // weekly payouts every Monday for the last 4 weeks (like "Sent to Whop" in the reference)
    if (c.payout.payoutMethod) {
      const monday = new Date(now);
      monday.setUTCHours(9, 0, 0, 0);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      if (monday > now) monday.setUTCDate(monday.getUTCDate() - 7); // most recent Monday 09:00 UTC in the past
      for (let w = 4; w >= 1; w--) {
        const paidAt = new Date(monday.getTime() - (w - 1) * 7 * DAY);
        const eligible = await db
          .select({ id: earnings.id, amountCents: earnings.amountCents })
          .from(earnings)
          .where(and(eq(earnings.userId, user!.id), isNull(earnings.payoutId), lte(earnings.maturesAt, paidAt)));
        const total = eligible.reduce((s, e) => s + e.amountCents, 0);
        if (total < settings.minPayoutCents) continue;
        const [p] = await db
          .insert(payouts)
          .values({
            userId: user!.id,
            method: c.payout.payoutMethod,
            amountCents: total,
            currency: env.currency,
            status: "paid",
            destination: c.payout.payoutMethod === "paypal" ? c.payout.paypalEmail : c.payout.stripeAccountId,
            providerRef: c.payout.payoutMethod === "stripe" ? `tr_seed_${w}${user!.id.slice(0, 6)}` : `SEEDITEM${w}${user!.id.slice(0, 6).toUpperCase()}`,
            requestedById: admin!.id,
            approvedById: admin!.id,
            requestedAt: paidAt,
            processedAt: paidAt,
            paidAt,
          })
          .returning();
        await db.update(earnings).set({ payoutId: p!.id }).where(inArray(earnings.id, eligible.map((e) => e.id)));
      }
    }

    await db.insert(notifications).values({
      userId: user!.id,
      title: "📣 Message from your manager",
      body: "New brief for Summer Clips is live — hooks in the first 2 seconds, captions on. Let's go!",
      url: "/app",
      createdAt: new Date(now.getTime() - 5 * HOUR),
    });
  }

  // one pending withdrawal request so the admin queue isn't empty
  const [alex] = await db.select().from(users).where(eq(users.email, "alex@22earn.local"));
  const { requestPayout } = await import("../src/lib/payouts");
  await requestPayout({ userId: alex!.id, actorId: alex!.id, notifyAdmin: true }).catch((e) => console.warn("(no pending request seeded)", e.message));

  console.log("✔ Demo data created");
  console.log(`  Admin   → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Creator → alex@22earn.local / ${CREATOR_PASSWORD}  (also sofia@…, malik@…)`);
}

main()
  .catch((err) => {
    console.error("✖ seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
