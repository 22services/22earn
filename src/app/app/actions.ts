"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { campaigns, notifications, posts, pushSubscriptions, socialAccounts, users, type Platform } from "@/db/schema";
import { requireInfluencer, requireUser } from "@/lib/auth";
import { CAMPAIGN_COOKIE, isMember } from "@/lib/campaign-context";
import { providers } from "@/lib/env";
import { AppError, runAction, type ActionState } from "@/lib/errors";
import { getGoalSnapshot } from "@/lib/goals";
import { cancelPayout, requestPayout } from "@/lib/payouts";
import { createConnectedAccount, dashboardUrl, onboardingUrl } from "@/lib/payouts/stripe";
import { isValidTimeZone } from "@/lib/time";
import { emailSchema, nameSchema, normalizeHandle, normalizeVideoUrl, parseForm, uuidSchema, z } from "@/lib/validation";
import { platformMeta } from "@/components/platform-icon";
import { STRIPE_COUNTRIES } from "@/lib/countries";

const platformSchema = z.enum(["tiktok", "instagram", "youtube"], { error: "Choose a platform." });
const followersSchema = z.coerce
  .number({ error: "Followers must be a number." })
  .int()
  .min(0, { error: "Followers can't be negative." })
  .max(2_000_000_000);
const avatarSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v == null || /^https:\/\//.test(v), { error: "The picture link must start with https://" });

/* --------------------------------------------------------- campaign pill */

export async function selectCampaignAction(formData: FormData) {
  const user = await requireInfluencer();
  const id = String(formData.get("campaignId") ?? "all");
  const jar = await cookies();
  if (id === "all" || !(await isMember(user.id, [id]))) jar.delete(CAMPAIGN_COOKIE);
  else jar.set(CAMPAIGN_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
}

/* ---------------------------------------------------------------- videos */

export async function submitVideoAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireInfluencer();
    const data = parseForm(
      z.object({
        url: z.string({ error: "Paste the video link." }).min(1, { error: "Paste the video link." }),
        socialAccountId: uuidSchema,
        campaignId: uuidSchema,
      }),
      formData,
    );
    const [account] = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, data.socialAccountId), eq(socialAccounts.userId, user.id)))
      .limit(1);
    if (!account) throw new AppError("Choose one of your accounts.");
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, data.campaignId)).limit(1);
    if (!campaign || !(await isMember(user.id, [campaign.id]))) throw new AppError("You're not part of this campaign.");
    if (campaign.status !== "active") throw new AppError(`"${campaign.name}" is not accepting videos right now.`);

    const url = normalizeVideoUrl(data.url);
    const host = new URL(url).hostname;
    if (!platformMeta[account.platform].host.test(host))
      throw new AppError(`That doesn't look like a ${platformMeta[account.platform].label} link for @${account.handle}.`);

    const [existing] = await db.select({ id: posts.id }).from(posts).where(eq(posts.url, url)).limit(1);
    if (existing) throw new AppError("This video was already submitted.");

    await db.insert(posts).values({ userId: user.id, socialAccountId: account.id, campaignId: campaign.id, url });
    const snap = await getGoalSnapshot(user.id, user.timezone);
    revalidatePath("/app", "layout");
    const left = Math.max(0, snap.dailyGoal - snap.todayCount);
    return {
      ok: true,
      message:
        left === 0
          ? `Submitted! 🎉 Daily goal reached (${snap.todayCount}/${snap.dailyGoal}). Keep the streak going!`
          : `Submitted! ${snap.todayCount}/${snap.dailyGoal} today — ${left} more to hit your goal.`,
    };
  });
}

export async function deletePendingVideoAction(formData: FormData) {
  const user = await requireInfluencer();
  const id = uuidSchema.safeParse(formData.get("postId"));
  if (!id.success) return;
  await db.delete(posts).where(and(eq(posts.id, id.data), eq(posts.userId, user.id), eq(posts.status, "pending")));
  revalidatePath("/app", "layout");
}

/* -------------------------------------------------------------- accounts */

export async function saveAccountAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let done = false;
  const result = await runAction(async () => {
    const user = await requireInfluencer();
    const data = parseForm(
      z.object({
        id: z.string().optional(),
        platform: platformSchema,
        handle: z.string().trim().min(1, { error: "Enter the account handle." }).max(60),
        followers: followersSchema,
        avatarUrl: avatarSchema,
      }),
      formData,
    );
    const handle = normalizeHandle(data.handle);
    if (!/^[a-z0-9._-]{1,50}$/.test(handle)) throw new AppError("Use the handle only, e.g. @alex.clips");
    const [taken] = await db
      .select({ id: socialAccounts.id, userId: socialAccounts.userId })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.platform, data.platform as Platform), eq(socialAccounts.handle, handle)))
      .limit(1);
    if (taken && taken.id !== data.id) throw new AppError(`@${handle} on ${platformMeta[data.platform].label} is already registered.`);

    if (data.id) {
      const [updated] = await db
        .update(socialAccounts)
        .set({ platform: data.platform, handle, followers: data.followers, avatarUrl: data.avatarUrl })
        .where(and(eq(socialAccounts.id, data.id), eq(socialAccounts.userId, user.id)))
        .returning({ id: socialAccounts.id });
      if (!updated) throw new AppError("Account not found.");
    } else {
      await db.insert(socialAccounts).values({ userId: user.id, platform: data.platform, handle, followers: data.followers, avatarUrl: data.avatarUrl, goalPerDay: 1 });
    }
    revalidatePath("/app", "layout");
    done = true;
  });
  if (done) redirect("/app/accounts");
  return result;
}

export async function deleteAccountAction(formData: FormData) {
  const user = await requireInfluencer();
  const id = uuidSchema.safeParse(formData.get("id"));
  if (id.success) await db.delete(socialAccounts).where(and(eq(socialAccounts.id, id.data), eq(socialAccounts.userId, user.id)));
  revalidatePath("/app", "layout");
  redirect("/app/accounts");
}

/* -------------------------------------------------------------- settings */

export async function updateProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireInfluencer();
    const data = parseForm(z.object({ name: nameSchema, timezone: z.string().refine(isValidTimeZone, { error: "Unknown timezone." }) }), formData);
    await db.update(users).set({ name: data.name, timezone: data.timezone }).where(eq(users.id, user.id));
    revalidatePath("/app", "layout");
    return { ok: true, message: "Profile saved." };
  });
}

export async function savePayPalAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireInfluencer();
    if (!providers.paypal()) throw new AppError("PayPal payouts are not enabled on this platform.");
    const { paypalEmail } = parseForm(z.object({ paypalEmail: emailSchema }), formData);
    await db
      .update(users)
      .set({ paypalEmail, payoutMethod: user.payoutMethod === "stripe" && user.stripeReady ? "stripe" : "paypal" })
      .where(eq(users.id, user.id));
    revalidatePath("/app", "layout");
    return { ok: true, message: "PayPal email saved." };
  });
}

export async function setPayoutMethodAction(formData: FormData) {
  const user = await requireInfluencer();
  const method = z.enum(["stripe", "paypal"]).safeParse(formData.get("method"));
  if (!method.success) return;
  if (method.data === "stripe" && !user.stripeReady) return;
  if (method.data === "paypal" && !user.paypalEmail) return;
  await db.update(users).set({ payoutMethod: method.data }).where(eq(users.id, user.id));
  revalidatePath("/app", "layout");
}

export async function startStripeOnboardingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let url: string | null = null;
  const result = await runAction(async () => {
    const user = await requireInfluencer();
    if (!providers.stripe()) throw new AppError("Stripe payouts are not enabled on this platform.");
    let accountId = user.stripeAccountId;
    if (!accountId) {
      const { country } = parseForm(
        z.object({ country: z.string().refine((c) => STRIPE_COUNTRIES.some((s) => s.code === c), { error: "Choose your country." }) }),
        formData,
      );
      const account = await createConnectedAccount(user, country);
      // Only store it if nobody (double click) stored one meanwhile.
      const [saved] = await db
        .update(users)
        .set({ stripeAccountId: account.id, stripeCountry: country, stripeReady: account.ready })
        .where(and(eq(users.id, user.id), isNull(users.stripeAccountId)))
        .returning({ id: users.stripeAccountId });
      accountId = saved?.id ?? (await db.select({ id: users.stripeAccountId }).from(users).where(eq(users.id, user.id)))[0]?.id ?? account.id;
    }
    url = await onboardingUrl(accountId!);
  });
  if (url) redirect(url);
  return result;
}

export async function openStripeDashboardAction() {
  const user = await requireInfluencer();
  if (!user.stripeAccountId) redirect("/app/settings");
  const url = await dashboardUrl(user.stripeAccountId);
  redirect(url);
}

/* ------------------------------------------------------------- withdraws */

export async function requestWithdrawAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireInfluencer();
    const method = z.enum(["stripe", "paypal"]).optional().parse(formData.get("method") || undefined);
    const payout = await requestPayout({ userId: user.id, actorId: user.id, method });
    revalidatePath("/app", "layout");
    return { ok: true, message: `Withdrawal requested ✓ The admin will send it to your ${payout.method === "stripe" ? "Stripe" : "PayPal"} shortly.` };
  });
}

export async function cancelWithdrawAction(formData: FormData) {
  const user = await requireInfluencer();
  const id = uuidSchema.safeParse(formData.get("payoutId"));
  if (id.success) await cancelPayout(id.data, { id: user.id, role: "influencer" }).catch(() => null);
  revalidatePath("/app", "layout");
}

/* --------------------------------------------------------- notifications */

const subscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(500) }),
});

export async function savePushSubscriptionAction(subscription: unknown) {
  const user = await requireUser(); // admins get push too (withdrawal requests)
  const sub = subscriptionSchema.parse(subscription);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db
    .insert(pushSubscriptions)
    .values({ userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent } });
  return { ok: true };
}

export async function removePushSubscriptionAction(endpoint: string) {
  const user = await requireUser();
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)));
  return { ok: true };
}

export async function markNotificationsReadAction(formData: FormData) {
  const user = await requireInfluencer();
  const ids = formData.getAll("id").map(String).filter((id) => uuidSchema.safeParse(id).success);
  const where = ids.length
    ? and(eq(notifications.userId, user.id), inArray(notifications.id, ids), isNull(notifications.readAt))
    : and(eq(notifications.userId, user.id), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
  revalidatePath("/app");
}
