// By default each test file gets a fresh in-memory PostgreSQL (PGlite).
// Set TEST_DATABASE_URL=postgres://… to run the same suite against a real PostgreSQL
// (exercises real row locks for the concurrency tests).
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  process.env.PGLITE_DIR = "memory://";
  delete process.env.DATABASE_URL;
}
process.env.PAYOUTS_SIMULATE = "true";
process.env.CURRENCY = "USD";
