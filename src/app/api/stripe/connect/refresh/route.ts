import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { onboardingUrl } from "@/lib/payouts/stripe";

/** Account links are single-use; Stripe calls this when one expired — mint a fresh one. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${env.appUrl}/login`);
  if (!user.stripeAccountId) return NextResponse.redirect(`${env.appUrl}/app/settings`);
  try {
    return NextResponse.redirect(await onboardingUrl(user.stripeAccountId));
  } catch (err) {
    console.error("[stripe refresh]", err);
    return NextResponse.redirect(`${env.appUrl}/app/settings?stripe=error`);
  }
}
