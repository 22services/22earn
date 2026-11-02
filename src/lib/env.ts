/**
 * Runtime configuration. Everything is read lazily (functions/getters) so values come
 * from the server environment at runtime — never baked in at build time.
 */
const bool = (v: string | undefined) => v === "true" || v === "1";

export const env = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  get currency() {
    return (process.env.CURRENCY ?? "USD").toUpperCase();
  },
  get locale() {
    return process.env.APP_LOCALE ?? "en-US";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** Fake Stripe/PayPal calls so the whole money flow can be tried locally without keys. */
  get simulatePayouts() {
    return bool(process.env.PAYOUTS_SIMULATE);
  },
  stripe: {
    get secretKey() {
      return process.env.STRIPE_SECRET_KEY ?? "";
    },
    get webhookSecret() {
      return process.env.STRIPE_WEBHOOK_SECRET ?? "";
    },
    /** "full" (default) or "recipient" — see README › Stripe. */
    get serviceAgreement(): "full" | "recipient" {
      return process.env.STRIPE_SERVICE_AGREEMENT === "recipient" ? "recipient" : "full";
    },
    get defaultCountry() {
      return (process.env.STRIPE_DEFAULT_COUNTRY ?? "US").toUpperCase();
    },
  },
  paypal: {
    get clientId() {
      return process.env.PAYPAL_CLIENT_ID ?? "";
    },
    get clientSecret() {
      return process.env.PAYPAL_CLIENT_SECRET ?? "";
    },
    get mode(): "sandbox" | "live" {
      return process.env.PAYPAL_MODE === "live" ? "live" : "sandbox";
    },
    get webhookId() {
      return process.env.PAYPAL_WEBHOOK_ID ?? "";
    },
  },
  push: {
    get publicKey() {
      return process.env.VAPID_PUBLIC_KEY ?? "";
    },
    get privateKey() {
      return process.env.VAPID_PRIVATE_KEY ?? "";
    },
    get subject() {
      return process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
    },
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
};

export const providers = {
  stripe: () => env.simulatePayouts || env.stripe.secretKey.length > 0,
  paypal: () => env.simulatePayouts || (env.paypal.clientId.length > 0 && env.paypal.clientSecret.length > 0),
  push: () => env.push.publicKey.length > 0 && env.push.privateKey.length > 0,
};
