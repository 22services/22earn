/**
 * Stripe Connect (Express accounts) — the platform sends a Transfer to the influencer's
 * connected account; Stripe then pays it out to their bank on their payout schedule.
 * Docs: https://docs.stripe.com/connect/express-accounts
 *       https://docs.stripe.com/connect/separate-charges-and-transfers
 */
import Stripe from "stripe";
import { env } from "../env";
import { AppError } from "../errors";
import { randomToken } from "../crypto";
import { ProviderError, type SendOutcome, type SyncOutcome } from "./types";

let client: Stripe | null = null;

export function stripeClient() {
  if (!env.stripe.secretKey) throw new AppError("Stripe is not configured (STRIPE_SECRET_KEY is missing).");
  client ??= new Stripe(env.stripe.secretKey, { appInfo: { name: "22earn" }, maxNetworkRetries: 2 });
  return client;
}

export const transferGroup = (payoutId: string) => `payout_${payoutId}`;

export function isTransfersActive(account: Pick<Stripe.Account, "capabilities">) {
  return account.capabilities?.transfers === "active";
}

export async function createConnectedAccount(user: { id: string; email: string }, country: string) {
  if (env.simulatePayouts) return { id: `acct_sim_${randomToken(8)}`, ready: false };
  const account = await stripeClient().accounts.create({
    type: "express",
    country,
    email: user.email,
    business_type: "individual",
    capabilities: { transfers: { requested: true } },
    ...(env.stripe.serviceAgreement === "recipient" ? { tos_acceptance: { service_agreement: "recipient" } } : {}),
    metadata: { userId: user.id },
  });
  return { id: account.id, ready: isTransfersActive(account) };
}

export async function onboardingUrl(accountId: string) {
  if (env.simulatePayouts) return `${env.appUrl}/api/stripe/connect/return?simulated=1`;
  const link = await stripeClient().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${env.appUrl}/api/stripe/connect/refresh`,
    return_url: `${env.appUrl}/api/stripe/connect/return`,
  });
  return link.url;
}

export async function accountReadiness(accountId: string) {
  if (env.simulatePayouts) return { ready: true, payoutsEnabled: true };
  const account = await stripeClient().accounts.retrieve(accountId);
  return { ready: isTransfersActive(account), payoutsEnabled: Boolean(account.payouts_enabled) };
}

/** One-time link to the influencer's Stripe Express dashboard (balance, bank, payouts). */
export async function dashboardUrl(accountId: string) {
  if (env.simulatePayouts) return "https://dashboard.stripe.com/test/connect/accounts/overview";
  const link = await stripeClient().accounts.createLoginLink(accountId);
  return link.url;
}

function classify(err: unknown): ProviderError {
  if (err instanceof Stripe.errors.StripeError) {
    const definitive = [
      "StripeInvalidRequestError",
      "StripeAuthenticationError",
      "StripePermissionError",
      "StripeCardError",
      "StripeIdempotencyError",
    ].includes(err.type);
    return new ProviderError(`Stripe: ${err.message}`, definitive);
  }
  if (err instanceof AppError) return new ProviderError(err.message, true);
  return new ProviderError(`Stripe: ${(err as Error)?.message ?? "unknown error"}`, false);
}

export async function sendStripeTransfer(payout: {
  id: string;
  amountCents: number;
  currency: string;
  destination: string;
  userId: string;
}): Promise<SendOutcome> {
  if (env.simulatePayouts) return { state: "paid", providerRef: `tr_sim_${randomToken(8)}` };
  try {
    const stripe = stripeClient();
    // Belt and braces: idempotency keys expire after 24 h, so look for an existing
    // transfer of this payout before creating one (protects late manual retries).
    const existing = await stripe.transfers.list({ transfer_group: transferGroup(payout.id), limit: 1 });
    if (existing.data[0]) return { state: "paid", providerRef: existing.data[0].id };
    const transfer = await stripe.transfers.create(
      {
        amount: payout.amountCents,
        currency: payout.currency.toLowerCase(),
        destination: payout.destination,
        transfer_group: transferGroup(payout.id),
        description: "22earn creator payout",
        metadata: { payoutId: payout.id, userId: payout.userId },
      },
      { idempotencyKey: `payout-${payout.id}` },
    );
    return { state: "paid", providerRef: transfer.id };
  } catch (err) {
    throw classify(err);
  }
}

export async function syncStripeTransfer(payoutId: string): Promise<SyncOutcome> {
  if (env.simulatePayouts) return { state: "paid" };
  try {
    const existing = await stripeClient().transfers.list({ transfer_group: transferGroup(payoutId), limit: 1 });
    const transfer = existing.data[0];
    if (!transfer) return { state: "processing", note: "No transfer found at Stripe yet — use Retry." };
    if (transfer.reversed) return { state: "failed", reason: "Transfer was reversed in Stripe." };
    return { state: "paid", providerRef: transfer.id };
  } catch (err) {
    throw classify(err);
  }
}

export function constructStripeEvent(body: string, signature: string) {
  if (!env.stripe.webhookSecret) throw new AppError("STRIPE_WEBHOOK_SECRET is not configured.");
  return stripeClient().webhooks.constructEvent(body, signature, env.stripe.webhookSecret);
}
