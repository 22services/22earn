/**
 * PayPal Payouts API — sends money from the owner's PayPal Business balance to the
 * influencer's PayPal email.
 * Docs: https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
 *       https://developer.paypal.com/docs/payouts/standard/reference/webhooks
 *
 * Payout items are asynchronous: creation returns PENDING, the final state arrives via
 * webhook (or "Sync status"). We always re-read the state from the API rather than
 * trusting a webhook body.
 */
import { env } from "../env";
import { AppError } from "../errors";
import { centsToDecimalString } from "../money";
import { ProviderError, type SendOutcome, type SyncOutcome } from "./types";

const baseUrl = () => (env.paypal.mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

let token: { value: string; expiresAt: number } | null = null;

async function accessToken() {
  if (!env.paypal.clientId || !env.paypal.clientSecret) throw new AppError("PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).");
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new ProviderError(`PayPal authentication failed (${res.status}). Check your client id/secret and PAYPAL_MODE.`, true);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function api<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof ProviderError || err instanceof AppError) throw err;
    throw new ProviderError(`PayPal unreachable: ${(err as Error).message}`, false);
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const name = String(json.name ?? res.status);
    const message = String(json.message ?? res.statusText);
    // 4xx = PayPal rejected the request (validation, insufficient funds, …) → nothing was sent.
    throw new ProviderError(`PayPal ${name}: ${message}`, res.status >= 400 && res.status < 500);
  }
  return json as T;
}

interface BatchResponse {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: Array<{
    payout_item_id: string;
    transaction_status?: string;
    payout_item?: { sender_item_id?: string };
    errors?: { name?: string; message?: string };
  }>;
}

export async function sendPayPalPayout(payout: {
  id: string;
  amountCents: number;
  currency: string;
  destination: string;
}): Promise<SendOutcome> {
  if (env.simulatePayouts) return { state: "processing", providerBatchId: `SIMBATCH-${payout.id.slice(0, 8).toUpperCase()}` };
  const res = await api<BatchResponse>("/v1/payments/payouts", {
    method: "POST",
    // Same request id on retry → PayPal returns the original batch instead of paying twice.
    headers: { "PayPal-Request-Id": `payout-${payout.id}` },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: payout.id,
        email_subject: "You have a payout!",
        email_message: "Your creator earnings have been sent. Thanks for posting!",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: payout.destination,
          amount: { value: centsToDecimalString(payout.amountCents), currency: payout.currency.toUpperCase() },
          note: "Creator earnings",
          sender_item_id: payout.id,
        },
      ],
    }),
  });
  return { state: "processing", providerBatchId: res.batch_header.payout_batch_id };
}

const FAILED = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"]);

export function mapPayPalItemStatus(status: string | undefined, errorMessage?: string): SyncOutcome {
  const s = (status ?? "PENDING").toUpperCase();
  if (s === "SUCCESS") return { state: "paid" };
  if (FAILED.has(s)) return { state: "failed", reason: `PayPal: ${s.toLowerCase()}${errorMessage ? ` — ${errorMessage}` : ""}` };
  if (s === "UNCLAIMED")
    return {
      state: "processing",
      note: "Unclaimed — the recipient must log in to / create a PayPal account with this email within 30 days.",
    };
  if (s === "ONHOLD") return { state: "processing", note: "On hold for review by PayPal." };
  return { state: "processing", note: null };
}

export async function syncPayPalPayout(batchId: string): Promise<SyncOutcome> {
  if (env.simulatePayouts) return { state: "paid", providerRef: `SIMITEM-${batchId.slice(-8)}` };
  const res = await api<BatchResponse>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  if (res.batch_header.batch_status === "DENIED") return { state: "failed", reason: "PayPal denied the payout batch." };
  const item = res.items?.[0];
  if (!item) return { state: "processing", note: null };
  const outcome = mapPayPalItemStatus(item.transaction_status, item.errors?.message);
  if (outcome.state !== "failed") outcome.providerRef = item.payout_item_id;
  return outcome;
}

/** Verifies a webhook with PayPal's verify-webhook-signature endpoint. */
export async function verifyPayPalWebhook(headers: Headers, event: unknown) {
  if (!env.paypal.webhookId) throw new AppError("PAYPAL_WEBHOOK_ID is not configured.");
  const res = await api<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: env.paypal.webhookId,
      webhook_event: event,
    }),
  });
  return res.verification_status === "SUCCESS";
}
