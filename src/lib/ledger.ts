/**
 * The earnings ledger.
 *
 * Every cent an influencer earns is an append-only row in `earnings` (integer cents, signed).
 * Nothing is ever edited in place: corrections are new negative rows. Balances are derived:
 *
 *   maturing   = unpaid rows whose hold period is not over yet       (the "maturing (48 h)" line)
 *   available  = unpaid rows that matured                          (what can be withdrawn now)
 *   pending    = maturing + available                              (the big "Pending" number)
 *   inTransit  = rows attached to a requested/processing payout
 *   paid       = rows attached to a paid payout                     ("Sent to Stripe / PayPal")
 */
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, type DB } from "@/db";
import { campaigns, earnings, payouts, posts, type EarningKind } from "@/db/schema";
import { AppError } from "./errors";
import { getSettings } from "./settings";
import { addHours } from "./time";

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

export interface Balance {
  maturingCents: number;
  availableCents: number;
  pendingCents: number;
  inTransitCents: number;
  paidCents: number;
  nextMaturityAt: Date | null;
}

const toNum = (v: unknown) => Number(v ?? 0);
const toDate = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));

export async function getBalance(
  userId: string,
  opts: { campaignId?: string | null; now?: Date; dbx?: Executor } = {},
): Promise<Balance> {
  const now = (opts.now ?? new Date()).toISOString();
  const dbx = opts.dbx ?? db;
  const conditions = [eq(earnings.userId, userId)];
  if (opts.campaignId) conditions.push(eq(earnings.campaignId, opts.campaignId));

  const [row] = await dbx
    .select({
      maturing: sql`coalesce(sum(case when ${earnings.payoutId} is null and ${earnings.maturesAt} > ${now}::timestamptz then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      available: sql`coalesce(sum(case when ${earnings.payoutId} is null and ${earnings.maturesAt} <= ${now}::timestamptz then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      inTransit: sql`coalesce(sum(case when ${payouts.status} in ('requested', 'processing') then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      paid: sql`coalesce(sum(case when ${payouts.status} = 'paid' then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      nextMaturityAt: sql`min(case when ${earnings.payoutId} is null and ${earnings.maturesAt} > ${now}::timestamptz then ${earnings.maturesAt} end)`.mapWith(toDate),
    })
    .from(earnings)
    .leftJoin(payouts, eq(earnings.payoutId, payouts.id))
    .where(and(...conditions));

  const maturingCents = row?.maturing ?? 0;
  const availableCents = row?.available ?? 0;
  return {
    maturingCents,
    availableCents,
    pendingCents: maturingCents + availableCents,
    inTransitCents: row?.inTransit ?? 0,
    paidCents: row?.paid ?? 0,
    nextMaturityAt: row?.nextMaturityAt ?? null,
  };
}

/** Balances for many users at once (admin tables). */
export async function getBalancesByUser(now = new Date()) {
  const iso = now.toISOString();
  const rows = await db
    .select({
      userId: earnings.userId,
      maturing: sql`coalesce(sum(case when ${earnings.payoutId} is null and ${earnings.maturesAt} > ${iso}::timestamptz then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      available: sql`coalesce(sum(case when ${earnings.payoutId} is null and ${earnings.maturesAt} <= ${iso}::timestamptz then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      inTransit: sql`coalesce(sum(case when ${payouts.status} in ('requested', 'processing') then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
      paid: sql`coalesce(sum(case when ${payouts.status} = 'paid' then ${earnings.amountCents} else 0 end), 0)`.mapWith(toNum),
    })
    .from(earnings)
    .leftJoin(payouts, eq(earnings.payoutId, payouts.id))
    .groupBy(earnings.userId);
  return new Map(rows.map((r) => [r.userId, { maturingCents: r.maturing, availableCents: r.available, inTransitCents: r.inTransit, paidCents: r.paid }]));
}

/* --------------------------------------------------------- views → money */

export interface FrozenRates {
  cpmCents: number;
  flatFeeCents: number;
  maxCents: number | null;
}

/** Flat fee owed for a video, respecting the per-video cap. */
export function flatFeeTarget(rates: FrozenRates) {
  const fee = Math.max(0, rates.flatFeeCents);
  return rates.maxCents == null ? fee : Math.min(fee, Math.max(0, rates.maxCents));
}

/** Views money owed for a video: floor(views × CPM / 1000), capped so flat + views ≤ cap. */
export function viewsTarget(views: number, rates: FrozenRates) {
  const raw = Math.floor((Math.max(0, views) * Math.max(0, rates.cpmCents)) / 1000);
  if (rates.maxCents == null) return raw;
  return Math.max(0, Math.min(raw, rates.maxCents - flatFeeTarget(rates)));
}

async function sumForPost(tx: Executor, postId: string, kind: EarningKind) {
  const [row] = await tx
    .select({ total: sql`coalesce(sum(${earnings.amountCents}), 0)`.mapWith(toNum) })
    .from(earnings)
    .where(and(eq(earnings.postId, postId), eq(earnings.kind, kind)));
  return row?.total ?? 0;
}

/**
 * Bring the ledger in line with a video's current state. Idempotent: it only writes the
 * difference between what is owed and what was already booked for this video.
 */
export async function reconcilePostEarnings(tx: Tx, postId: string, actorId: string | null, now = new Date()) {
  const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post) throw new AppError("Video not found.");
  const { holdHours } = await getSettings(tx);

  const owed =
    post.status === "approved"
      ? (() => {
          const rates: FrozenRates = {
            cpmCents: post.rateCpmCents ?? 0,
            flatFeeCents: post.rateFlatFeeCents ?? 0,
            maxCents: post.rateMaxCents,
          };
          return { flat_fee: flatFeeTarget(rates), views: viewsTarget(post.views, rates) };
        })()
      : { flat_fee: 0, views: 0 }; // rejected / pending videos are owed nothing

  const written: { kind: EarningKind; amountCents: number }[] = [];
  for (const kind of ["flat_fee", "views"] as const) {
    const booked = await sumForPost(tx, postId, kind);
    const delta = owed[kind] - booked;
    if (delta === 0) continue;
    await tx.insert(earnings).values({
      userId: post.userId,
      campaignId: post.campaignId,
      postId: post.id,
      kind,
      amountCents: delta,
      note:
        delta < 0
          ? post.status === "rejected"
            ? "Video rejected — reversal"
            : "Correction"
          : kind === "views"
            ? `${new Intl.NumberFormat("en-US").format(post.views)} views`
            : "Approved video",
      // new money waits for the hold period; corrections apply immediately
      maturesAt: delta > 0 ? addHours(now, holdHours) : now,
      createdById: actorId,
    });
    written.push({ kind, amountCents: delta });
  }
  return written;
}

/* ------------------------------------------------------ manual entries */

export async function addManualEarning(input: {
  userId: string;
  amountCents: number;
  kind: Extract<EarningKind, "bonus" | "adjustment">;
  note: string;
  campaignId?: string | null;
  actorId: string;
  applyHold?: boolean;
}) {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new AppError("Enter a non-zero amount.");
  if (input.kind === "bonus" && input.amountCents < 0) throw new AppError("A bonus must be positive — use an adjustment to remove money.");
  const { holdHours } = await getSettings();
  const now = new Date();
  const [row] = await db
    .insert(earnings)
    .values({
      userId: input.userId,
      campaignId: input.campaignId || null,
      kind: input.kind,
      amountCents: input.amountCents,
      note: input.note.trim() || (input.kind === "bonus" ? "Bonus" : "Adjustment"),
      maturesAt: input.applyHold && input.amountCents > 0 ? addHours(now, holdHours) : now,
      createdById: input.actorId,
    })
    .returning();
  return row!;
}

/* ------------------------------------------------------------- history */

export async function listEarnings(userId: string, opts: { campaignId?: string | null; limit?: number } = {}) {
  const conditions = [eq(earnings.userId, userId)];
  if (opts.campaignId) conditions.push(eq(earnings.campaignId, opts.campaignId));
  return db
    .select({
      id: earnings.id,
      kind: earnings.kind,
      amountCents: earnings.amountCents,
      note: earnings.note,
      maturesAt: earnings.maturesAt,
      createdAt: earnings.createdAt,
      payoutId: earnings.payoutId,
      payoutStatus: payouts.status,
      campaignName: campaigns.name,
      postUrl: posts.url,
    })
    .from(earnings)
    .leftJoin(payouts, eq(earnings.payoutId, payouts.id))
    .leftJoin(campaigns, eq(earnings.campaignId, campaigns.id))
    .leftJoin(posts, eq(earnings.postId, posts.id))
    .where(and(...conditions))
    .orderBy(desc(earnings.createdAt))
    .limit(opts.limit ?? 100);
}

/**
 * Transfer history. When a campaign is selected, each payout shows only the part of it
 * that came from that campaign.
 */
export async function listTransfers(userId: string, opts: { campaignId?: string | null; limit?: number } = {}) {
  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.userId, userId))
    .orderBy(desc(payouts.requestedAt))
    .limit(opts.limit ?? 100);
  if (!opts.campaignId || rows.length === 0) return rows.map((p) => ({ ...p, displayCents: p.amountCents }));

  const parts = await db
    .select({ payoutId: earnings.payoutId, total: sql`sum(${earnings.amountCents})`.mapWith(toNum) })
    .from(earnings)
    .where(and(eq(earnings.campaignId, opts.campaignId), inArray(earnings.payoutId, rows.map((r) => r.id))))
    .groupBy(earnings.payoutId);
  const byPayout = new Map(parts.map((p) => [p.payoutId, p.total]));
  return rows
    .filter((p) => byPayout.has(p.id))
    .map((p) => ({ ...p, displayCents: byPayout.get(p.id) ?? 0 }));
}

/** Rows that would be swept into a payout right now. */
export function eligibleEarningsWhere(userId: string, now: Date) {
  return and(eq(earnings.userId, userId), isNull(earnings.payoutId), lte(earnings.maturesAt, now));
}
