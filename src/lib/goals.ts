/**
 * "Pushed to post often": daily goals per social account, streaks and compliance.
 * Days are computed in each influencer's own timezone.
 */
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { posts, socialAccounts, users } from "@/db/schema";
import { addDaysToKey, localDateKey } from "./time";

const LOOKBACK_DAYS = 120;

export interface GoalSnapshot {
  dailyGoal: number;
  todayCount: number;
  todayByAccount: Map<string, number>;
  streak: number;
  last7: { key: string; count: number; met: boolean }[];
  daysMetLast7: number;
  lastPostAt: Date | null;
}

/** Pure computation, shared by the influencer app and the admin dashboard (unit-tested). */
export function computeGoalSnapshot(input: {
  timezone: string;
  dailyGoal: number;
  posts: { createdAt: Date; socialAccountId: string | null }[];
  now?: Date;
}): GoalSnapshot {
  const now = input.now ?? new Date();
  const today = localDateKey(now, input.timezone);
  const byDay = new Map<string, number>();
  const todayByAccount = new Map<string, number>();
  let lastPostAt: Date | null = null;

  for (const p of input.posts) {
    const key = localDateKey(p.createdAt, input.timezone);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
    if (key === today && p.socialAccountId) todayByAccount.set(p.socialAccountId, (todayByAccount.get(p.socialAccountId) ?? 0) + 1);
    if (!lastPostAt || p.createdAt > lastPostAt) lastPostAt = p.createdAt;
  }

  const goal = Math.max(0, input.dailyGoal);
  const met = (key: string) => goal > 0 && (byDay.get(key) ?? 0) >= goal;

  // Streak: consecutive days meeting the goal. Today only counts once it's met,
  // so a streak isn't "broken" in the morning before you've posted.
  let streak = 0;
  let cursor = met(today) ? today : addDaysToKey(today, -1);
  while (met(cursor) && streak < LOOKBACK_DAYS) {
    streak++;
    cursor = addDaysToKey(cursor, -1);
  }

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(today, i - 6);
    const count = byDay.get(key) ?? 0;
    return { key, count, met: met(key) };
  });

  return {
    dailyGoal: goal,
    todayCount: byDay.get(today) ?? 0,
    todayByAccount,
    streak,
    last7,
    daysMetLast7: last7.filter((d) => d.met).length,
    lastPostAt,
  };
}

const since = () => new Date(Date.now() - (LOOKBACK_DAYS + 1) * 86_400_000);

export async function getGoalSnapshot(userId: string, timezone: string) {
  const [accounts, recent] = await Promise.all([
    db.select({ goalPerDay: socialAccounts.goalPerDay }).from(socialAccounts).where(eq(socialAccounts.userId, userId)),
    db
      .select({ createdAt: posts.createdAt, socialAccountId: posts.socialAccountId })
      .from(posts)
      .where(and(eq(posts.userId, userId), ne(posts.status, "rejected"), gte(posts.createdAt, since()))),
  ]);
  const dailyGoal = accounts.reduce((s, a) => s + a.goalPerDay, 0);
  return computeGoalSnapshot({ timezone, dailyGoal, posts: recent });
}

/** Goal snapshots for every active influencer (admin dashboard, reminders). */
export async function getAllGoalSnapshots() {
  const influencers = await db
    .select({ id: users.id, name: users.name, email: users.email, timezone: users.timezone, lastReminderSlot: users.lastReminderSlot })
    .from(users)
    .where(and(eq(users.role, "influencer"), eq(users.status, "active")));
  if (influencers.length === 0) return [];
  const ids = influencers.map((i) => i.id);
  const [accounts, recent] = await Promise.all([
    db.select({ userId: socialAccounts.userId, goalPerDay: socialAccounts.goalPerDay }).from(socialAccounts).where(inArray(socialAccounts.userId, ids)),
    db
      .select({ userId: posts.userId, createdAt: posts.createdAt, socialAccountId: posts.socialAccountId })
      .from(posts)
      .where(and(inArray(posts.userId, ids), ne(posts.status, "rejected"), gte(posts.createdAt, since()))),
  ]);
  return influencers.map((u) => ({
    user: u,
    snapshot: computeGoalSnapshot({
      timezone: u.timezone,
      dailyGoal: accounts.filter((a) => a.userId === u.id).reduce((s, a) => s + a.goalPerDay, 0),
      posts: recent.filter((p) => p.userId === u.id),
    }),
  }));
}
