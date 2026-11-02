import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { accountReadiness } from "@/lib/payouts/stripe";

/** Stripe sends the influencer back here after onboarding — refresh their readiness. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login`);
  if (user.stripeAccountId) {
    try {
      const { ready } = await accountReadiness(user.stripeAccountId);
      await db
        .update(users)
        .set({ stripeReady: ready, ...(ready && (!user.payoutMethod || !user.paypalEmail) ? { payoutMethod: "stripe" as const } : {}) })
        .where(eq(users.id, user.id));
      return NextResponse.redirect(`${env.appUrl}/app/settings?stripe=${ready ? "ready" : "pending"}`);
    } catch (err) {
      console.error("[stripe return]", err);
    }
  }
  return NextResponse.redirect(`${env.appUrl}/app/settings?stripe=error`);
}
