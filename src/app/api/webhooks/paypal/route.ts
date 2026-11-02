import { eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { payouts } from "@/db/schema";
import { syncPayout } from "@/lib/payouts";
import { verifyPayPalWebhook } from "@/lib/payouts/paypal";
import { uuidSchema } from "@/lib/validation";

interface PayPalEvent {
  id?: string;
  event_type?: string;
  resource?: {
    payout_batch_id?: string;
    batch_header?: { payout_batch_id?: string; sender_batch_header?: { sender_batch_id?: string } };
    payout_item?: { sender_item_id?: string };
    sender_batch_id?: string;
  };
}

/**
 * PayPal Payouts webhooks. The signature is verified with PayPal, then we re-read the
 * payout's real status from the PayPal API (never trusting the body alone).
 */
export async function POST(request: Request) {
  const raw = await request.text();
  let event: PayPalEvent;
  try {
    event = JSON.parse(raw) as PayPalEvent;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    if (!(await verifyPayPalWebhook(request.headers, event))) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  } catch (err) {
    console.warn("[paypal webhook] verification failed:", (err as Error).message);
    return NextResponse.json({ error: "verification failed" }, { status: 400 });
  }

  if (!event.event_type?.startsWith("PAYMENT.PAYOUTS")) return NextResponse.json({ ignored: true });

  const r = event.resource ?? {};
  const batchId = r.payout_batch_id ?? r.batch_header?.payout_batch_id;
  const senderId = r.payout_item?.sender_item_id ?? r.batch_header?.sender_batch_header?.sender_batch_id ?? r.sender_batch_id;
  const conditions = [];
  if (batchId) conditions.push(eq(payouts.providerBatchId, batchId));
  if (senderId && uuidSchema.safeParse(senderId).success) conditions.push(eq(payouts.id, senderId));
  if (!conditions.length) return NextResponse.json({ ignored: true });

  const [payout] = await db.select({ id: payouts.id }).from(payouts).where(or(...conditions)).limit(1);
  if (!payout) return NextResponse.json({ ignored: true });

  try {
    await syncPayout(payout.id);
  } catch (err) {
    console.error("[paypal webhook] sync failed", err);
    return NextResponse.json({ error: "sync failed" }, { status: 500 }); // PayPal retries
  }
  return NextResponse.json({ received: true });
}
