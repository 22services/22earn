"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { campaignMembers, campaigns, posts, settings, socialAccounts, users } from "@/db/schema";
import { destroyAllSessionsFor, hashPassword, requireAdmin, verifyPassword } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError, runAction, type ActionState } from "@/lib/errors";
import { addManualEarning, reconcilePostEarnings } from "@/lib/ledger";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { notify } from "@/lib/notify";
import { approvePayout, cancelPayout, payAllAvailable, retryPayout, syncPayout } from "@/lib/payouts";
import { getSettings, parseReminderHours } from "@/lib/settings";
import { emailSchema, nameSchema, parseForm, passwordSchema, uuidSchema, z } from "@/lib/validation";

const INVITE_DAYS = 7;

function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}

function toCents(label: string, v: string, allowNegative: boolean, ctx: z.RefinementCtx) {
  const cents = parseMoneyToCents(v);
  if (cents == null || (!allowNegative && cents < 0)) {
    ctx.addIssue({ code: "custom", message: `${label}: enter an amount like 12.50` });
    return z.NEVER;
  }
  return cents;
}

/** Required money input → integer cents. */
const moneyField = (label: string, { allowNegative = false } = {}) =>
  z.string({ error: `${label} is required.` }).trim().min(1, { error: `${label} is required.` }).transform((v, ctx) => toCents(label, v, allowNegative, ctx));

/** Optional money input → integer cents or null. */
const optionalMoneyField = (label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx): number | null => (v && v.trim() ? toCents(label, v, false, ctx) : null));

async function issueInviteLink(userId: string) {
  const token = randomToken(24);
  await db
    .update(users)
    .set({ inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) })
    .where(eq(users.id, userId));
  return `${env.appUrl}/invite/${token}`;
}

/* ------------------------------------------------------------ people */

export async function inviteUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const data = parseForm(
      z.object({ name: nameSchema, email: emailSchema, role: z.enum(["influencer", "admin"]).default("influencer") }),
      formData,
    );
    const campaignIds = formData.getAll("campaignId").map(String).filter((id) => uuidSchema.safeParse(id).success);
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, data.email)).limit(1);
    if (exists) throw new AppError("Someone with this email already exists.");
    const [user] = await db.insert(users).values({ name: data.name, email: data.email, role: data.role, status: "invited" }).returning();
    if (campaignIds.length) await db.insert(campaignMembers).values(campaignIds.map((campaignId) => ({ campaignId, userId: user!.id }))).onConflictDoNothing();
    const link = await issueInviteLink(user!.id);
    refresh();
    return { ok: true, message: `Invite ready for ${data.name}. Send them this link (valid ${INVITE_DAYS} days):`, data: { link } };
  });
}

/** New invite link — for pending invites, or as a password-reset link for active users. */
export async function issueLinkAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const userId = uuidSchema.parse(formData.get("userId"));
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppError("User not found.");
    if (user.status === "disabled") throw new AppError("Enable the account first.");
    const link = await issueInviteLink(user.id);
    return {
      ok: true,
      message: user.status === "invited" ? "New invite link (the old one no longer works):" : "Password reset link — it signs them out everywhere once used:",
      data: { link },
    };
  });
}

export async function setUserStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = uuidSchema.parse(formData.get("userId"));
  const enable = formData.get("enable") === "true";
  if (userId === admin.id) return;
  await db
    .update(users)
    .set({ status: enable ? sql`case when ${users.passwordHash} is null then 'invited'::user_status else 'active'::user_status end` : "disabled" })
    .where(eq(users.id, userId));
  if (!enable) await destroyAllSessionsFor(userId);
  refresh();
}

export async function updateUserAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const data = parseForm(z.object({ userId: uuidSchema, name: nameSchema, email: emailSchema }), formData);
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, data.email), ne(users.id, data.userId)))
      .limit(1);
    if (clash) throw new AppError("Another account already uses this email.");
    await db.update(users).set({ name: data.name, email: data.email }).where(eq(users.id, data.userId));
    refresh();
    return { ok: true, message: "Saved." };
  });
}

export async function setMembershipsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const userId = uuidSchema.parse(formData.get("userId"));
    const wanted = new Set(formData.getAll("campaignId").map(String).filter((id) => uuidSchema.safeParse(id).success));
    await db.transaction(async (tx) => {
      await tx.delete(campaignMembers).where(eq(campaignMembers.userId, userId));
      if (wanted.size) await tx.insert(campaignMembers).values([...wanted].map((campaignId) => ({ campaignId, userId })));
    });
    refresh();
    return { ok: true, message: "Campaigns updated." };
  });
}

export async function setGoalAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const data = parseForm(
      z.object({
        accountId: uuidSchema,
        goalPerDay: z.coerce.number({ error: "Goal must be a number." }).int().min(0, { error: "Goal can't be negative." }).max(50),
        followers: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
      }),
      formData,
    );
    await db
      .update(socialAccounts)
      .set({ goalPerDay: data.goalPerDay, ...(data.followers != null ? { followers: data.followers } : {}) })
      .where(eq(socialAccounts.id, data.accountId));
    refresh();
    return { ok: true, message: "Saved." };
  });
}

export async function addEarningAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const data = parseForm(
      z.object({
        userId: uuidSchema,
        kind: z.enum(["bonus", "adjustment"]),
        amount: moneyField("Amount", { allowNegative: true }),
        note: z.string().trim().max(200).default(""),
        campaignId: z.string().optional(),
        applyHold: z.string().optional(),
      }),
      formData,
    );
    const campaignId = data.campaignId && uuidSchema.safeParse(data.campaignId).success ? data.campaignId : null;
    await addManualEarning({
      userId: data.userId,
      amountCents: data.amount,
      kind: data.kind,
      note: data.note,
      campaignId,
      actorId: admin.id,
      applyHold: data.applyHold === "on",
    });
    if (data.amount > 0) {
      await notify(data.userId, {
        title: data.kind === "bonus" ? "🎁 You got a bonus!" : "Balance updated",
        body: `${formatMoney(data.amount, { sign: true })}${data.note ? ` — ${data.note}` : ""}`,
        url: "/app/earnings?view=activity",
      });
    }
    refresh();
    return { ok: true, message: `${formatMoney(data.amount, { sign: true })} added to the ledger.` };
  });
}

export async function nudgeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const data = parseForm(
      z.object({ target: z.string(), message: z.string().trim().min(1, { error: "Write a short message." }).max(200) }),
      formData,
    );
    let ids: string[];
    if (data.target === "all" || data.target === "behind") {
      const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "influencer"), eq(users.status, "active")));
      ids = rows.map((r) => r.id);
      if (data.target === "behind") {
        const { getAllGoalSnapshots } = await import("@/lib/goals");
        const snaps = await getAllGoalSnapshots();
        const behind = new Set(snaps.filter((s) => s.snapshot.dailyGoal > 0 && s.snapshot.todayCount < s.snapshot.dailyGoal).map((s) => s.user.id));
        ids = ids.filter((id) => behind.has(id));
      }
    } else {
      ids = [uuidSchema.parse(data.target)];
    }
    await Promise.all(ids.map((id) => notify(id, { title: "📣 Message from your manager", body: data.message, url: "/app" })));
    refresh();
    return { ok: true, message: `Sent to ${ids.length} creator${ids.length === 1 ? "" : "s"}.` };
  });
}

/* --------------------------------------------------------- campaigns */

const campaignSchema = z.object({
  name: z.string().trim().min(1, { error: "Give the campaign a name." }).max(80),
  description: z.string().trim().max(2000).default(""),
  status: z.enum(["active", "paused", "ended"]).default("active"),
  cpm: optionalMoneyField("Rate per 1,000 views"),
  flatFee: optionalMoneyField("Fee per video"),
  maxPerPost: optionalMoneyField("Max per video"),
});

export async function saveCampaignAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const data = parseForm(campaignSchema.extend({ id: z.string().optional() }), formData);
    const values = {
      name: data.name,
      description: data.description,
      status: data.status,
      cpmCents: data.cpm ?? 0,
      flatFeeCents: data.flatFee ?? 0,
      maxPerPostCents: data.maxPerPost,
    };
    if (data.id) {
      await db.update(campaigns).set(values).where(eq(campaigns.id, uuidSchema.parse(data.id)));
    } else {
      const [c] = await db.insert(campaigns).values(values).returning();
      const memberIds = formData.getAll("userId").map(String).filter((id) => uuidSchema.safeParse(id).success);
      if (memberIds.length) await db.insert(campaignMembers).values(memberIds.map((userId) => ({ campaignId: c!.id, userId }))).onConflictDoNothing();
    }
    refresh();
    return { ok: true, message: data.id ? "Campaign saved. New rates apply to videos approved from now on." : "Campaign created." };
  });
}

export async function setCampaignMembersAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const campaignId = uuidSchema.parse(formData.get("campaignId"));
    const wanted = new Set(formData.getAll("userId").map(String).filter((id) => uuidSchema.safeParse(id).success));
    await db.transaction(async (tx) => {
      await tx.delete(campaignMembers).where(eq(campaignMembers.campaignId, campaignId));
      if (wanted.size) await tx.insert(campaignMembers).values([...wanted].map((userId) => ({ campaignId, userId })));
    });
    refresh();
    return { ok: true, message: "Members updated." };
  });
}

/* ------------------------------------------------------------ videos */

const viewsSchema = z.coerce
  .number({ error: "Views must be a number." })
  .int({ error: "Views must be a whole number." })
  .min(0, { error: "Views can't be negative." })
  .max(2_000_000_000, { error: "That's more views than we can store." });

export async function reviewPostAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const data = parseForm(
      z.object({
        postId: uuidSchema,
        decision: z.enum(["approve", "reject"]),
        note: z.string().trim().max(300).optional(),
        views: z.string().optional(),
      }),
      formData,
    );
    const views = data.views && data.views.trim() !== "" ? viewsSchema.parse(data.views) : undefined;

    const result = await db.transaction(async (tx) => {
      const [post] = await tx.select().from(posts).where(eq(posts.id, data.postId)).for("update");
      if (!post) throw new AppError("Video not found.");
      if (data.decision === "approve") {
        if (post.status === "approved") throw new AppError("Already approved.");
        const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, post.campaignId)).limit(1);
        await tx
          .update(posts)
          .set({
            status: "approved",
            reviewNote: null,
            reviewedAt: new Date(),
            reviewedById: admin.id,
            rateCpmCents: campaign!.cpmCents,
            rateFlatFeeCents: campaign!.flatFeeCents,
            rateMaxCents: campaign!.maxPerPostCents,
            ...(views != null ? { views, viewsUpdatedAt: new Date() } : {}),
          })
          .where(eq(posts.id, post.id));
      } else {
        if (post.status === "rejected") throw new AppError("Already rejected.");
        await tx
          .update(posts)
          .set({ status: "rejected", reviewNote: data.note || "Not eligible for this campaign.", reviewedAt: new Date(), reviewedById: admin.id })
          .where(eq(posts.id, post.id));
      }
      const written = await reconcilePostEarnings(tx, post.id, admin.id);
      return { post, written };
    });

    const total = result.written.reduce((s, w) => s + w.amountCents, 0);
    await notify(result.post.userId, {
      title: data.decision === "approve" ? "✅ Video approved" : "Video not approved",
      body:
        data.decision === "approve"
          ? total > 0
            ? `${formatMoney(total, { sign: true })} added — it unlocks after the maturing period.`
            : "It now earns with every view update."
          : data.note || "Not eligible for this campaign.",
      url: "/app/videos",
    });
    refresh();
    return { ok: true, message: data.decision === "approve" ? `Approved${total ? ` · ${formatMoney(total, { sign: true })}` : ""}` : "Rejected" };
  });
}

export async function updateViewsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const data = parseForm(z.object({ postId: uuidSchema, views: viewsSchema }), formData);
    const written = await db.transaction(async (tx) => {
      const [post] = await tx.select().from(posts).where(eq(posts.id, data.postId)).for("update");
      if (!post) throw new AppError("Video not found.");
      if (post.status === "rejected") throw new AppError("This video was rejected — approve it first.");
      await tx.update(posts).set({ views: data.views, viewsUpdatedAt: new Date() }).where(eq(posts.id, post.id));
      return reconcilePostEarnings(tx, post.id, admin.id);
    });
    refresh();
    const delta = written.reduce((s, w) => s + w.amountCents, 0);
    return { ok: true, message: delta ? `${formatMoney(delta, { sign: true })}` : "Saved" };
  });
}

/* ----------------------------------------------------------- payouts */

const payoutIdSchema = z.object({ payoutId: uuidSchema });

export async function approvePayoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const { payoutId } = parseForm(payoutIdSchema, formData);
    const p = await approvePayout(payoutId, admin.id).finally(refresh);
    return { ok: true, message: p.status === "paid" ? `Sent ${formatMoney(p.amountCents)} ✓` : "Sent — waiting for PayPal confirmation." };
  });
}

export async function rejectPayoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const data = parseForm(payoutIdSchema.extend({ reason: z.string().trim().max(300).optional() }), formData);
    await cancelPayout(data.payoutId, { id: admin.id, role: "admin" }, data.reason);
    refresh();
    return { ok: true, message: "Request rejected — the money is back in their balance." };
  });
}

export async function retryPayoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const { payoutId } = parseForm(payoutIdSchema, formData);
    const p = await retryPayout(payoutId).finally(refresh);
    return { ok: true, message: `Status: ${p.status}` };
  });
}

export async function syncPayoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const { payoutId } = parseForm(payoutIdSchema, formData);
    const p = await syncPayout(payoutId).finally(refresh);
    return { ok: true, message: `Status: ${p.status}${p.failureReason ? ` — ${p.failureReason}` : ""}` };
  });
}

export async function payAllAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const s = await payAllAvailable(admin.id).finally(refresh);
    const parts = [`${s.sent} sent`, s.processing ? `${s.processing} awaiting PayPal` : null, s.failed.length ? `${s.failed.length} failed` : null, `${formatMoney(s.totalCents)} total`].filter(Boolean);
    const details = [...s.failed.map((f) => `✕ ${f.name}: ${f.reason}`), ...s.skipped.map((k) => `– ${k.name}: ${k.reason}`)].join("\n");
    if (s.sent + s.processing + s.failed.length === 0 && s.skipped.length === 0) return { ok: true, message: "Nothing to pay right now." };
    return { ok: s.failed.length === 0, message: parts.join(" · "), data: details ? { details } : undefined };
  });
}

/* ---------------------------------------------------------- settings */

export async function updateSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireAdmin();
    const data = parseForm(
      z.object({
        holdHours: z.coerce.number({ error: "Hold must be a number of hours." }).int().min(0).max(24 * 60),
        minPayout: moneyField("Minimum withdrawal"),
        reminderHours: z.string().default(""),
      }),
      formData,
    );
    if (data.minPayout < 100) throw new AppError(`The minimum withdrawal must be at least ${formatMoney(100)}.`);
    const hours = parseReminderHours(data.reminderHours);
    await getSettings();
    await db
      .update(settings)
      .set({ holdHours: data.holdHours, minPayoutCents: data.minPayout, reminderHours: hours.join(",") })
      .where(eq(settings.id, 1));
    refresh();
    return { ok: true, message: "Settings saved." };
  });
}

export async function changePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    const data = parseForm(z.object({ current: z.string().min(1, { error: "Enter your current password." }), password: passwordSchema }), formData);
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, admin.id));
    if (!(await verifyPassword(data.current, row?.hash))) throw new AppError("Your current password is wrong.");
    await db.update(users).set({ passwordHash: await hashPassword(data.password) }).where(eq(users.id, admin.id));
    return { ok: true, message: "Password changed." };
  });
}
