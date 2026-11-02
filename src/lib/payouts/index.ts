/**
 * Payout lifecycle — the only place money leaves the platform.
 *
 *   requested ──approve──▶ processing ──▶ paid
 *       │                      │
 *       └─reject/cancel─▶ canceled        └──▶ failed   (earnings go back to the balance)
 *
 * Safety rules:
 *  - creating a payout locks the user row, so two clicks can never sweep the same earnings twice;
 *  - every status change is a conditional UPDATE (… WHERE status = expected), so a payout can
 *    only be sent once even if two admins click "Approve" at the same time;
 *  - provider calls use idempotency keys (Stripe) / request ids (PayPal);
 *  - only *definitive* provider errors release the money; ambiguous ones stay "processing".
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { earnings, payouts, users, type Payout, type PayoutMethod, type PayoutStatus } from "@/db/schema";
import { env, providers } from "../env";
import { AppError } from "../errors";
import { eligibleEarningsWhere, getBalance } from "../ledger";
import { formatMoney } from "../money";
import { notify, notifyAdmins } from "../notify";
import { getSettings } from "../settings";
import { sendPayPalPayout, syncPayPalPayout } from "./paypal";
import { sendStripeTransfer, syncStripeTransfer } from "./stripe";
import { ProviderError, type SendOutcome, type SyncOutcome } from "./types";

export const methodLabel = (m: PayoutMethod) => (m === "stripe" ? "Stripe" : "PayPal");

type PayoutUser = { id: string; payoutMethod: PayoutMethod | null; paypalEmail: string | null; stripeAccountId: string | null; stripeReady: boolean };

/** Where the money would go for this method, or a helpful error. */
export function resolveDestination(user: PayoutUser, method: PayoutMethod): string {
  if (method === "stripe") {
    if (!providers.stripe()) throw new AppError("Stripe payouts are not enabled on this platform.");
    if (!user.stripeAccountId) throw new AppError("Connect a Stripe account in Settings first.");
    if (!user.stripeReady) throw new AppError("Your Stripe account isn't ready to receive money yet — finish the Stripe onboarding in Settings.");
    return user.stripeAccountId;
  }
  if (!providers.paypal()) throw new AppError("PayPal payouts are not enabled on this platform.");
  if (!user.paypalEmail) throw new AppError("Add your PayPal email in Settings first.");
  return user.paypalEmail;
}

export function payoutReadiness(user: PayoutUser) {
  if (!user.payoutMethod) return { ready: false as const, reason: "No payout method set" };
  try {
    return { ready: true as const, destination: resolveDestination(user, user.payoutMethod) };
  } catch (err) {
    return { ready: false as const, reason: (err as Error).message };
  }
}

/* ----------------------------------------------------------- request */

export async function requestPayout(input: { userId: string; actorId: string; method?: PayoutMethod; notifyAdmin?: boolean }) {
  const { minPayoutCents } = await getSettings();
  const now = new Date();

  const payout = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        status: users.status,
        payoutMethod: users.payoutMethod,
        paypalEmail: users.paypalEmail,
        stripeAccountId: users.stripeAccountId,
        stripeReady: users.stripeReady,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user || user.status !== "active") throw new AppError("This account is not active.");

    const method = input.method ?? user.payoutMethod;
    if (!method) throw new AppError("Choose how you want to be paid (Stripe or PayPal) in Settings first.");
    const destination = resolveDestination(user, method);

    const [open] = await tx
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.userId, user.id), eq(payouts.status, "requested")))
      .limit(1);
    if (open) throw new AppError("A withdrawal is already waiting for approval.");

    const [created] = await tx
      .insert(payouts)
      .values({
        userId: user.id,
        method,
        amountCents: 0,
        currency: env.currency,
        status: "requested",
        destination,
        requestedById: input.actorId,
      })
      .returning();

    // Sweep every matured, unpaid ledger row into this payout — atomically.
    const swept = await tx
      .update(earnings)
      .set({ payoutId: created!.id })
      .where(eligibleEarningsWhere(user.id, now))
      .returning({ amountCents: earnings.amountCents });
    const total = swept.reduce((sum, r) => sum + r.amountCents, 0);

    if (total <= 0) throw new AppError("Nothing is available to withdraw yet.");
    if (total < minPayoutCents) throw new AppError(`The minimum withdrawal is ${formatMoney(minPayoutCents)} — you have ${formatMoney(total)} available.`);

    const [final] = await tx.update(payouts).set({ amountCents: total }).where(eq(payouts.id, created!.id)).returning();
    return final!;
  });

  if (input.notifyAdmin !== false && input.actorId === input.userId) {
    await notifyAdmins({
      title: "New withdrawal request",
      body: `${formatMoney(payout.amountCents)} via ${methodLabel(payout.method)} is waiting for approval.`,
      url: "/admin/payouts",
    });
  }
  return payout;
}

/* -------------------------------------------------------- transitions */

async function load(id: string) {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, id)).limit(1);
  if (!p) throw new AppError("Payout not found.");
  return p;
}

export async function markPaid(id: string, providerRef?: string | null) {
  const [p] = await db
    .update(payouts)
    .set({ status: "paid", paidAt: new Date(), failureReason: null, ...(providerRef ? { providerRef } : {}) })
    .where(and(eq(payouts.id, id), eq(payouts.status, "processing")))
    .returning();
  if (p) {
    await notify(p.userId, {
      title: "💸 Money sent",
      body: `${formatMoney(p.amountCents, { currency: p.currency })} was sent to your ${methodLabel(p.method)}.`,
      url: "/app/earnings",
      tag: `payout-${p.id}`,
    });
  }
  return p ?? (await load(id));
}

/** Provider refused / reversed: the payout fails and its earnings return to the balance. */
export async function markFailed(id: string, reason: string, opts: { fromPaid?: boolean } = {}) {
  const from: PayoutStatus[] = opts.fromPaid ? ["requested", "processing", "paid"] : ["requested", "processing"];
  const p = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(payouts)
      .set({ status: "failed", failureReason: reason.slice(0, 500) })
      .where(and(eq(payouts.id, id), inArray(payouts.status, from)))
      .returning();
    if (row) await tx.update(earnings).set({ payoutId: null }).where(eq(earnings.payoutId, id));
    return row;
  });
  if (p) {
    await notify(p.userId, {
      title: "Payout didn't go through",
      body: `${formatMoney(p.amountCents, { currency: p.currency })} is back in your balance. Check your payout settings.`,
      url: "/app/earnings",
    });
  }
  return p ?? (await load(id));
}

/** Admin rejects / influencer cancels a request that was not sent yet. */
export async function cancelPayout(id: string, actor: { id: string; role: "admin" | "influencer" }, reason?: string) {
  const p = await db.transaction(async (tx) => {
    const conditions = [eq(payouts.id, id), eq(payouts.status, "requested" as const)];
    if (actor.role !== "admin") conditions.push(eq(payouts.userId, actor.id));
    const [row] = await tx
      .update(payouts)
      .set({ status: "canceled", failureReason: reason?.slice(0, 500) || (actor.role === "admin" ? "Rejected by admin" : "Canceled") })
      .where(and(...conditions))
      .returning();
    if (row) await tx.update(earnings).set({ payoutId: null }).where(eq(earnings.payoutId, id));
    return row;
  });
  if (!p) throw new AppError("Only a request that hasn't been sent yet can be canceled.");
  if (actor.role === "admin") {
    await notify(p.userId, {
      title: "Withdrawal not approved",
      body: `${formatMoney(p.amountCents)} is back in your balance.${reason ? ` Reason: ${reason}` : ""}`,
      url: "/app/earnings",
    });
  }
  return p;
}

async function dispatch(p: Payout): Promise<Payout> {
  if (!p.destination) return markFailed(p.id, "No payout destination.");
  let outcome: SendOutcome;
  try {
    outcome =
      p.method === "stripe"
        ? await sendStripeTransfer({ id: p.id, amountCents: p.amountCents, currency: p.currency, destination: p.destination, userId: p.userId })
        : await sendPayPalPayout({ id: p.id, amountCents: p.amountCents, currency: p.currency, destination: p.destination });
  } catch (err) {
    if (err instanceof ProviderError && err.definitive) {
      await markFailed(p.id, err.message);
      throw new AppError(`${err.message} — the money was returned to the influencer's balance.`);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.update(payouts).set({ failureReason: `Awaiting confirmation: ${message}`.slice(0, 500) }).where(eq(payouts.id, p.id));
    throw new AppError(`Couldn't confirm the payout (${message}). It stays "processing" — Retry is safe, it can never pay twice.`);
  }

  if (outcome.state === "paid") return markPaid(p.id, outcome.providerRef);

  await db
    .update(payouts)
    .set({
      providerRef: outcome.providerRef ?? p.providerRef,
      providerBatchId: outcome.providerBatchId ?? p.providerBatchId,
      failureReason: outcome.note ?? null,
    })
    .where(eq(payouts.id, p.id));
  // PayPal is asynchronous: try one immediate status read (webhooks will follow).
  return syncPayout(p.id).catch(() => load(p.id));
}

export async function approvePayout(id: string, adminId: string) {
  const [claimed] = await db
    .update(payouts)
    .set({ status: "processing", approvedById: adminId, processedAt: new Date(), failureReason: null })
    .where(and(eq(payouts.id, id), eq(payouts.status, "requested")))
    .returning();
  if (!claimed) throw new AppError("This payout was already handled.");
  return dispatch(claimed);
}

/** Re-send a payout stuck in "processing" after an ambiguous error (idempotent). */
export async function retryPayout(id: string) {
  const p = await load(id);
  if (p.status !== "processing") throw new AppError("Only a processing payout can be retried.");
  if (p.method === "paypal" && p.providerBatchId) return syncPayout(id);
  return dispatch(p);
}

/** Ask the provider for the real state of a processing payout. */
export async function syncPayout(id: string) {
  const p = await load(id);
  if (p.status !== "processing") return p;
  const outcome: SyncOutcome =
    p.method === "paypal"
      ? p.providerBatchId
        ? await syncPayPalPayout(p.providerBatchId)
        : { state: "processing", note: "Not sent to PayPal yet — use Retry." }
      : await syncStripeTransfer(p.id);

  if (outcome.state === "paid") return markPaid(id, outcome.providerRef ?? p.providerRef);
  if (outcome.state === "failed") return markFailed(id, outcome.reason);
  const [updated] = await db
    .update(payouts)
    .set({ failureReason: outcome.note ?? null, ...(outcome.providerRef ? { providerRef: outcome.providerRef } : {}) })
    .where(and(eq(payouts.id, id), eq(payouts.status, "processing")))
    .returning();
  return updated ?? (await load(id));
}

/* ------------------------------------------------------------- batch */

export interface BatchSummary {
  sent: number;
  processing: number;
  failed: { name: string; reason: string }[];
  skipped: { name: string; reason: string }[];
  totalCents: number;
}

/** "Pay everyone": approve open requests, then pay every available balance ≥ minimum. */
export async function payAllAvailable(adminId: string): Promise<BatchSummary> {
  const summary: BatchSummary = { sent: 0, processing: 0, failed: [], skipped: [], totalCents: 0 };
  const { minPayoutCents } = await getSettings();

  const track = async (name: string, run: () => Promise<Payout>) => {
    try {
      const p = await run();
      if (p.status === "paid") {
        summary.sent++;
        summary.totalCents += p.amountCents;
      } else if (p.status === "processing") {
        summary.processing++;
        summary.totalCents += p.amountCents;
      } else summary.failed.push({ name, reason: p.failureReason ?? p.status });
    } catch (err) {
      summary.failed.push({ name, reason: err instanceof Error ? err.message : "error" });
    }
  };

  const open = await db
    .select({ id: payouts.id, name: users.name })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .where(eq(payouts.status, "requested"))
    .orderBy(payouts.requestedAt);
  for (const o of open) await track(o.name, () => approvePayout(o.id, adminId));

  const influencers = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "influencer"), eq(users.status, "active")))
    .orderBy(users.name);
  for (const u of influencers) {
    const { availableCents } = await getBalance(u.id);
    if (availableCents <= 0) continue;
    if (availableCents < minPayoutCents) {
      summary.skipped.push({ name: u.name, reason: `${formatMoney(availableCents)} is below the ${formatMoney(minPayoutCents)} minimum` });
      continue;
    }
    const readiness = payoutReadiness(u);
    if (!readiness.ready) {
      summary.skipped.push({ name: u.name, reason: readiness.reason });
      continue;
    }
    await track(u.name, async () => {
      const p = await requestPayout({ userId: u.id, actorId: adminId, notifyAdmin: false });
      return approvePayout(p.id, adminId);
    });
  }
  return summary;
}

/* ----------------------------------------------------------- queries */

export async function listPayoutsForAdmin(status?: PayoutStatus | "open") {
  const where =
    status === "open"
      ? inArray(payouts.status, ["requested", "processing"])
      : status
        ? eq(payouts.status, status)
        : undefined;
  return db
    .select({
      payout: payouts,
      userName: users.name,
      userEmail: users.email,
    })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .where(where)
    .orderBy(desc(payouts.requestedAt))
    .limit(200);
}

export async function payoutTotals() {
  const rows = await db
    .select({
      status: payouts.status,
      count: sql`count(*)`.mapWith(Number),
      total: sql`coalesce(sum(${payouts.amountCents}), 0)`.mapWith(Number),
    })
    .from(payouts)
    .groupBy(payouts.status);
  return Object.fromEntries(rows.map((r) => [r.status, { count: r.count, totalCents: r.total }])) as Partial<
    Record<PayoutStatus, { count: number; totalCents: number }>
  >;
}
