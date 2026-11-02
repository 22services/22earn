import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/db";
import { payouts, users } from "@/db/schema";
import { markFailed } from "@/lib/payouts";
import { constructStripeEvent, isTransfersActive } from "@/lib/payouts/stripe";

/**
 * Stripe webhooks (signature-verified).
 *  - account.updated   → keep "can this creator receive money?" in sync
 *  - transfer.reversed → a sent transfer was pulled back: mark failed, money returns to the balance
 */
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = constructStripeEvent(body, signature);
  } catch (err) {
    console.warn("[stripe webhook] rejected:", (err as Error).message);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object;
        await db.update(users).set({ stripeReady: isTransfersActive(account) }).where(eq(users.stripeAccountId, account.id));
        break;
      }
      case "transfer.reversed": {
        const transfer = event.data.object;
        if (transfer.amount_reversed >= transfer.amount) {
          const [payout] = await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.providerRef, transfer.id)).limit(1);
          if (payout) await markFailed(payout.id, "Transfer reversed in Stripe — the money is back in the creator's balance.", { fromPaid: true });
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler error", err);
    return NextResponse.json({ error: "handler error" }, { status: 500 }); // Stripe will retry
  }
  return NextResponse.json({ received: true });
}
