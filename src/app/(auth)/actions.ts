"use server";

import { and, count, eq, gt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  createSession,
  destroyAllSessionsFor,
  destroySession,
  hashPassword,
  homeFor,
  verifyPassword,
} from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { AppError, runAction, type ActionState } from "@/lib/errors";
import { isValidTimeZone } from "@/lib/time";
import { emailSchema, nameSchema, parseForm, passwordSchema, z } from "@/lib/validation";

const tz = z
  .string()
  .optional()
  .transform((v) => (v && isValidTimeZone(v) ? v : "UTC"));

/** Only same-site paths: "/app/x" ok — "//evil.com", "/\\evil.com", "https://…" are rejected. */
function safeNext(next: unknown, fallback: string) {
  return typeof next === "string" && /^\/(?![/\\])[^\s]*$/.test(next) && !next.includes("\\") ? next : fallback;
}

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let destination = "/";
  const result = await runAction(async () => {
    const { email, password, next } = parseForm(
      z.object({ email: emailSchema, password: z.string().min(1, { error: "Enter your password." }), next: z.string().optional() }),
      formData,
    );
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const key = `${ip}|${email}`;
    if (!checkLoginRateLimit(key)) throw new AppError("Too many attempts. Wait 15 minutes and try again.");

    const [user] = await db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid) throw new AppError("Wrong email or password.");
    if (user.status === "disabled") throw new AppError("This account has been disabled. Contact the admin.");
    if (user.status !== "active") throw new AppError("Finish your sign-up with the invite link you received.");

    clearLoginRateLimit(key);
    await createSession(user.id);
    destination = safeNext(next, homeFor(user));
  });
  if (result?.error) return result;
  redirect(destination);
}

export async function setupAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runAction(async () => {
    const data = parseForm(z.object({ name: nameSchema, email: emailSchema, password: passwordSchema, timezone: tz }), formData);
    const user = await db.transaction(async (tx) => {
      // Only possible while the database has no user at all.
      await tx.execute(sql`lock table ${users} in exclusive mode`);
      const [existing] = await tx.select({ value: count() }).from(users);
      if ((existing?.value ?? 0) > 0) throw new AppError("This platform is already set up. Sign in instead.");
      const [created] = await tx
        .insert(users)
        .values({ name: data.name, email: data.email, role: "admin", status: "active", passwordHash: await hashPassword(data.password), timezone: data.timezone })
        .returning();
      return created!;
    });
    await createSession(user.id);
  });
  if (result?.error) return result;
  redirect("/admin");
}

export async function acceptInviteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let destination = "/";
  const result = await runAction(async () => {
    const data = parseForm(z.object({ token: z.string().min(10), name: nameSchema, password: passwordSchema, timezone: tz }), formData);
    const [user] = await db
      .update(users)
      .set({
        name: data.name,
        passwordHash: await hashPassword(data.password),
        status: sql`case when ${users.status} = 'disabled' then 'disabled'::user_status else 'active'::user_status end`,
        timezone: data.timezone,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      })
      .where(and(eq(users.inviteTokenHash, sha256(data.token)), gt(users.inviteExpiresAt, new Date())))
      .returning();
    if (!user) throw new AppError("This link has expired or was already used. Ask the admin for a new one.");
    if (user.status === "disabled") throw new AppError("This account has been disabled.");
    await destroyAllSessionsFor(user.id); // a reset link signs out every other device
    await createSession(user.id);
    destination = homeFor(user);
  });
  if (result?.error) return result;
  redirect(destination);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
