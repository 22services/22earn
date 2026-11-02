/**
 * Countries where Stripe Connect accounts can be created (from Stripe's Connect
 * capability availability list). Transfers between regions have extra rules — see README.
 */
const CODES = [
  "AE", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GI", "GR", "HK", "HR",
  "HU", "IE", "IT", "JP", "LI", "LT", "LU", "LV", "MT", "MX", "NL", "NO", "NZ", "PL", "PT", "RO", "SE", "SG", "SI", "SK", "TH", "US",
] as const;

const names = new Intl.DisplayNames(["en"], { type: "region" });

export const STRIPE_COUNTRIES = CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
