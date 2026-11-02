/**
 * In-app notifications + Web Push. Push is best-effort: a failed push never breaks the
 * action that triggered it. Dead subscriptions (404/410) are removed automatically.
 */
import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notifications, pushSubscriptions, users } from "@/db/schema";
import { env, providers } from "./env";

let configured = false;
function ensureConfigured() {
  if (configured || !providers.push()) return providers.push();
  webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPush(userId: string, payload: PushPayload) {
  if (!ensureConfigured()) return { sent: 0 };
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...payload, url: payload.url ?? "/app" }),
          { TTL: 60 * 60 * 12, urgency: "normal" },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
        else console.warn("[push] failed", status ?? err);
      }
    }),
  );
  if (dead.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
  return { sent };
}

/** Store an in-app notification and push it to the user's devices. */
export async function notify(userId: string, payload: PushPayload) {
  try {
    await db.insert(notifications).values({ userId, title: payload.title, body: payload.body, url: payload.url ?? null });
    await sendPush(userId, payload);
  } catch (err) {
    console.warn("[notify] failed", err);
  }
}

export async function notifyAdmins(payload: PushPayload) {
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  await Promise.all(admins.map((a) => notify(a.id, payload)));
}
