import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { earnings, payouts, posts, users } from "@/db/schema";
import { addManualEarning, flatFeeTarget, getBalance, reconcilePostEarnings, viewsTarget } from "@/lib/ledger";
import { approvePayout, cancelPayout, markFailed, payAllAvailable, requestPayout, syncPayout } from "@/lib/payouts";
import { makePost, makeWorld, migrateTestDb, setHoldHours } from "./helpers";

async function approve(postId: string, adminId: string, views = 0) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  const [campaign] = await db.query.campaigns.findMany({ where: (c, { eq }) => eq(c.id, post!.campaignId) });
  return db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({
        status: "approved",
        views,
        rateCpmCents: campaign!.cpmCents,
        rateFlatFeeCents: campaign!.flatFeeCents,
        rateMaxCents: campaign!.maxPerPostCents,
      })
      .where(eq(posts.id, postId));
    return reconcilePostEarnings(tx, postId, adminId);
  });
}

async function setViews(postId: string, views: number, adminId: string) {
  return db.transaction(async (tx) => {
    await tx.update(posts).set({ views }).where(eq(posts.id, postId));
    return reconcilePostEarnings(tx, postId, adminId);
  });
}

beforeAll(async () => {
  await migrateTestDb();
});

describe("views → money", () => {
  it("pays floor(views × CPM / 1000)", () => {
    expect(viewsTarget(123_456, { cpmCents: 150, flatFeeCents: 0, maxCents: null })).toBe(18_518); // $185.18
    expect(viewsTarget(999, { cpmCents: 1, flatFeeCents: 0, maxCents: null })).toBe(0);
  });

  it("caps flat fee + views at the per-video maximum", () => {
    const rates = { cpmCents: 200, flatFeeCents: 1_000, maxCents: 5_000 };
    expect(flatFeeTarget(rates)).toBe(1_000);
    expect(viewsTarget(10_000_000, rates)).toBe(4_000);
    expect(flatFeeTarget({ cpmCents: 0, flatFeeCents: 9_000, maxCents: 5_000 })).toBe(5_000);
  });
});

describe("ledger", () => {
  it("books a flat fee on approval and the views delta on each update — idempotently", async () => {
    await setHoldHours(48);
    const w = await makeWorld({ cpmCents: 150, flatFeeCents: 500 });
    const post = await makePost(w, `https://www.tiktok.com/@alex/video/1-${crypto.randomUUID()}`);

    await approve(post.id, w.admin.id, 10_000); // $5 fee + $15 views
    let b = await getBalance(w.influencer.id);
    expect(b.maturingCents).toBe(2_000);
    expect(b.availableCents).toBe(0);
    expect(b.pendingCents).toBe(2_000);

    await setViews(post.id, 30_000, w.admin.id); // +$30
    await setViews(post.id, 30_000, w.admin.id); // no-op
    b = await getBalance(w.influencer.id);
    expect(b.pendingCents).toBe(500 + 4_500);

    const rows = await db.select().from(earnings).where(eq(earnings.postId, post.id));
    expect(rows).toHaveLength(3);

    // after the 48 h hold everything is available
    b = await getBalance(w.influencer.id, { now: new Date(Date.now() + 49 * 3_600_000) });
    expect(b.maturingCents).toBe(0);
    expect(b.availableCents).toBe(5_000);
  });

  it("freezes rates at approval time (later campaign edits don't rewrite the deal)", async () => {
    const w = await makeWorld({ cpmCents: 100, flatFeeCents: 0 });
    const post = await makePost(w, `https://www.tiktok.com/@alex/video/frozen-${crypto.randomUUID()}`);
    await approve(post.id, w.admin.id, 1_000);
    await db.update(posts).set({ rateCpmCents: 100 }).where(eq(posts.id, post.id));
    await setViews(post.id, 2_000, w.admin.id);
    expect((await getBalance(w.influencer.id)).pendingCents).toBe(200);
  });

  it("reverses everything when an approved video is rejected, and re-approval restores it", async () => {
    await setHoldHours(0);
    const w = await makeWorld({ cpmCents: 100, flatFeeCents: 300 });
    const post = await makePost(w, `https://www.tiktok.com/@alex/video/2-${crypto.randomUUID()}`);
    await approve(post.id, w.admin.id, 5_000);
    expect((await getBalance(w.influencer.id)).pendingCents).toBe(800);

    await db.transaction(async (tx) => {
      await tx.update(posts).set({ status: "rejected" }).where(eq(posts.id, post.id));
      await reconcilePostEarnings(tx, post.id, w.admin.id);
    });
    expect((await getBalance(w.influencer.id)).pendingCents).toBe(0);

    await approve(post.id, w.admin.id, 5_000);
    expect((await getBalance(w.influencer.id)).pendingCents).toBe(800);
  });

  it("filters balances by campaign", async () => {
    await setHoldHours(0);
    const w = await makeWorld({ cpmCents: 0, flatFeeCents: 1_000 });
    const other = await makeWorld({ cpmCents: 0, flatFeeCents: 0 });
    await addManualEarning({ userId: w.influencer.id, amountCents: 700, kind: "bonus", note: "Top creator", actorId: w.admin.id, campaignId: other.campaign.id });
    const post = await makePost(w, `https://www.tiktok.com/@alex/video/3-${crypto.randomUUID()}`);
    await approve(post.id, w.admin.id);
    expect((await getBalance(w.influencer.id)).pendingCents).toBe(1_700);
    expect((await getBalance(w.influencer.id, { campaignId: w.campaign.id })).pendingCents).toBe(1_000);
    expect((await getBalance(w.influencer.id, { campaignId: other.campaign.id })).pendingCents).toBe(700);
  });
});

describe("payouts", () => {
  it("sweeps only matured money, respects the minimum and blocks double requests", async () => {
    await setHoldHours(0, 1_000);
    const w = await makeWorld();
    await addManualEarning({ userId: w.influencer.id, amountCents: 500, kind: "bonus", note: "", actorId: w.admin.id });
    await expect(requestPayout({ userId: w.influencer.id, actorId: w.influencer.id })).rejects.toThrow(/minimum/);
    // the failed attempt rolled back: nothing is attached to a payout
    expect((await getBalance(w.influencer.id)).availableCents).toBe(500);

    await addManualEarning({ userId: w.influencer.id, amountCents: 1_500, kind: "bonus", note: "", actorId: w.admin.id });
    await setHoldHours(48, 1_000);
    await addManualEarning({ userId: w.influencer.id, amountCents: 999, kind: "bonus", note: "", actorId: w.admin.id, applyHold: true });

    const payout = await requestPayout({ userId: w.influencer.id, actorId: w.influencer.id });
    expect(payout.amountCents).toBe(2_000); // the maturing $9.99 stays behind
    expect(payout.method).toBe("paypal");
    const b = await getBalance(w.influencer.id);
    expect(b.inTransitCents).toBe(2_000);
    expect(b.maturingCents).toBe(999);
    expect(b.availableCents).toBe(0);

    await expect(requestPayout({ userId: w.influencer.id, actorId: w.influencer.id })).rejects.toThrow(/already waiting/);
  });

  it("concurrent withdraw clicks can never sweep the same money twice", async () => {
    await setHoldHours(0, 100);
    const w = await makeWorld();
    await addManualEarning({ userId: w.influencer.id, amountCents: 5_000, kind: "bonus", note: "", actorId: w.admin.id });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => requestPayout({ userId: w.influencer.id, actorId: w.influencer.id })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const all = await db.select().from(payouts).where(eq(payouts.userId, w.influencer.id));
    expect(all.reduce((s, p) => s + p.amountCents, 0)).toBe(5_000);
  });

  it("approves once, pays via PayPal (async) and Stripe (instant), and records it as sent", async () => {
    await setHoldHours(0, 100);
    const w = await makeWorld();
    await addManualEarning({ userId: w.influencer.id, amountCents: 4_861, kind: "bonus", note: "", actorId: w.admin.id });
    const req = await requestPayout({ userId: w.influencer.id, actorId: w.influencer.id });

    const [a, b] = await Promise.allSettled([approvePayout(req.id, w.admin.id), approvePayout(req.id, w.admin.id)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const paid = await syncPayout(req.id);
    expect(paid.status).toBe("paid");
    expect(paid.providerBatchId).toMatch(/^SIMBATCH-/);
    const bal = await getBalance(w.influencer.id);
    expect(bal.paidCents).toBe(4_861);
    expect(bal.pendingCents).toBe(0);

    // Stripe
    await db.update(users).set({ payoutMethod: "stripe", stripeAccountId: `acct_sim_${w.influencer.id.slice(0, 6)}`, stripeReady: true }).where(eq(users.id, w.influencer.id));
    await addManualEarning({ userId: w.influencer.id, amountCents: 1_000, kind: "bonus", note: "", actorId: w.admin.id });
    const req2 = await requestPayout({ userId: w.influencer.id, actorId: w.influencer.id });
    const sent = await approvePayout(req2.id, w.admin.id);
    expect(sent.status).toBe("paid");
    expect(sent.providerRef).toMatch(/^tr_sim_/);
    expect((await getBalance(w.influencer.id)).paidCents).toBe(5_861);
  });

  it("a failed or rejected payout puts the money back in the balance", async () => {
    await setHoldHours(0, 100);
    const w = await makeWorld();
    await addManualEarning({ userId: w.influencer.id, amountCents: 3_000, kind: "bonus", note: "", actorId: w.admin.id });

    const r1 = await requestPayout({ userId: w.influencer.id, actorId: w.influencer.id });
    await cancelPayout(r1.id, { id: w.admin.id, role: "admin" }, "Check your PayPal email");
    expect((await getBalance(w.influencer.id)).availableCents).toBe(3_000);

    const r2 = await requestPayout({ userId: w.influencer.id, actorId: w.influencer.id });
    await db.update(payouts).set({ status: "processing" }).where(eq(payouts.id, r2.id));
    await markFailed(r2.id, "PayPal RECEIVER_UNREGISTERED");
    const b = await getBalance(w.influencer.id);
    expect(b.availableCents).toBe(3_000);
    expect(b.inTransitCents).toBe(0);
    const linked = await db.select().from(earnings).where(and(eq(earnings.userId, w.influencer.id), eq(earnings.payoutId, r2.id)));
    expect(linked).toHaveLength(0);
  });

  it("an influencer cannot cancel someone else's request", async () => {
    await setHoldHours(0, 100);
    const w = await makeWorld();
    const intruder = await makeWorld();
    await addManualEarning({ userId: w.influencer.id, amountCents: 1_000, kind: "bonus", note: "", actorId: w.admin.id });
    const r = await requestPayout({ userId: w.influencer.id, actorId: w.influencer.id });
    await expect(cancelPayout(r.id, { id: intruder.influencer.id, role: "influencer" })).rejects.toThrow();
  });

  it("pay-all sends every eligible balance and explains the skipped ones", async () => {
    await setHoldHours(0, 1_000);
    const w = await makeWorld();
    await addManualEarning({ userId: w.influencer.id, amountCents: 2_500, kind: "bonus", note: "", actorId: w.admin.id });
    const small = await makeWorld();
    await addManualEarning({ userId: small.influencer.id, amountCents: 300, kind: "bonus", note: "", actorId: w.admin.id });
    const summary = await payAllAvailable(w.admin.id);
    expect(summary.failed.filter((f) => f.name === "Alex")).toEqual([]);
    expect(summary.sent + summary.processing).toBeGreaterThanOrEqual(1);
    expect(summary.skipped.some((s) => s.reason.includes("minimum"))).toBe(true);
    expect((await getBalance(w.influencer.id)).pendingCents).toBe(0);
  });
});
