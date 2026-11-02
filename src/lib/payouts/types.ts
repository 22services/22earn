export type SendOutcome =
  | { state: "paid"; providerRef: string }
  | { state: "processing"; providerRef?: string | null; providerBatchId?: string | null; note?: string | null };

export type SyncOutcome =
  | { state: "paid"; providerRef?: string | null }
  | { state: "processing"; note?: string | null; providerRef?: string | null }
  | { state: "failed"; reason: string };

/**
 * definitive = the provider certainly did NOT move money (safe to release the earnings).
 * ambiguous  = we can't know (timeout, 5xx) — keep the payout "processing" and retry with
 *              the same idempotency key, which can never pay twice.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly definitive: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
