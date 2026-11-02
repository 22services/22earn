import { and, eq, isNull, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getAllGoalSnapshots } from "@/lib/goals";
import { sendPush } from "@/lib/notify";
import { getSettings, parseReminderHours } from "@/lib/settings";
import { localDateKey, localHour } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * "Pushed to post often": call every 15–60 minutes (Docker cron service, Vercel Cron,
 * cron-job.org…). At each configured local hour, creators who haven't hit today's goal
 * get one push. Each (creator, day, hour) slot is claimed atomically, so overlapping
 * calls never double-send.
 */
async function handle(request: Request) {
  if (!env.cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env.cronSecret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const settings = await getSettings();
  const hours = parseReminderHours(settings.reminderHours);
  const lastHour = hours.at(-1);
  const snaps = await getAllGoalSnapshots();
  let reminded = 0;

  for (const { user, snapshot } of snaps) {
    if (snapshot.dailyGoal === 0) continue;
    const hour = localHour(now, user.timezone);
    if (!hours.includes(hour)) continue;
    const left = snapshot.dailyGoal - snapshot.todayCount;
    if (left <= 0) continue;

    const slot = `${localDateKey(now, user.timezone)}T${String(hour).padStart(2, "0")}`;
    const [claimed] = await db
      .update(users)
      .set({ lastReminderSlot: slot })
      .where(and(eq(users.id, user.id), or(isNull(users.lastReminderSlot), ne(users.lastReminderSlot, slot))))
      .returning({ id: users.id });
    if (!claimed) continue;

    const first = user.name.split(" ")[0];
    const videos = `${left} video${left > 1 ? "s" : ""}`;
    const body =
      snapshot.streak > 0
        ? `${videos} left today to keep your 🔥 ${snapshot.streak}-day streak.`
        : `You're at ${snapshot.todayCount}/${snapshot.dailyGoal} today. Post now and start a streak!`;
    const { sent } = await sendPush(user.id, {
      title: hour === lastHour ? `Last call, ${first} ⏰` : `Time to post, ${first} 🎬`,
      body,
      url: "/app/videos/new",
      tag: "daily-reminder",
    });
    if (sent > 0) reminded++;
  }

  return NextResponse.json({ ok: true, checked: snaps.length, reminded });
}

export const GET = handle;
export const POST = handle;
