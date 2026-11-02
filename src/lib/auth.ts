import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";

const COOKIE = "earn_session";
const SESSION_DAYS = 30;

export type SessionUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "status" | "timezone" | "avatarUrl" | "payoutMethod" | "paypalEmail" | "stripeAccountId" | "stripeReady" | "stripeCountry"
>;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string | null | undefined) {
  if (!hash) {
    // constant-ish time even when the user does not exist
    await bcrypt.compare(password, "$2b$12$ooZTmi9zwsVoklzb9q9tyute2Xyqjenxo9iwEivAbI8yHfgp0c3O2");
    return false;
  }
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: env.appUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

export async function destroyAllSessionsFor(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** The signed-in, active user for this request (memoized per request). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      timezone: users.timezone,
      avatarUrl: users.avatarUrl,
      payoutMethod: users.payoutMethod,
      paypalEmail: users.paypalEmail,
      stripeAccountId: users.stripeAccountId,
      stripeReady: users.stripeReady,
      stripeCountry: users.stripeCountry,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.status !== "active") return null;
  return row;
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/app");
  return user;
}

export async function requireInfluencer() {
  const user = await requireUser();
  if (user.role !== "influencer") redirect("/admin");
  return user;
}

export function homeFor(user: Pick<User, "role">) {
  return user.role === "admin" ? "/admin" : "/app";
}

/* ---------------------------------------------- tiny login rate limiter */

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export function checkLoginRateLimit(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }
  return entry.count <= MAX_ATTEMPTS;
}

export function clearLoginRateLimit(key: string) {
  attempts.delete(key);
}
