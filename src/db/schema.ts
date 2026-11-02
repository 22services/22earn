import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const roleEnum = pgEnum("role", ["admin", "influencer"]);
export const userStatusEnum = pgEnum("user_status", ["invited", "active", "disabled"]);
export const payoutMethodEnum = pgEnum("payout_method", ["stripe", "paypal"]);
export const platformEnum = pgEnum("platform", ["tiktok", "instagram", "youtube"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["active", "paused", "ended"]);
export const postStatusEnum = pgEnum("post_status", ["pending", "approved", "rejected"]);
export const earningKindEnum = pgEnum("earning_kind", ["views", "flat_fee", "bonus", "adjustment"]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "requested", // influencer (or admin) asked, waiting for admin approval
  "processing", // sent to provider, waiting for confirmation (PayPal) or ambiguous error
  "paid", // money landed at Stripe / PayPal
  "failed", // provider refused — earnings were released back to the balance
  "canceled", // rejected by admin or canceled by influencer — earnings released
]);

export type Role = (typeof roleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type PayoutMethod = (typeof payoutMethodEnum.enumValues)[number];
export type Platform = (typeof platformEnum.enumValues)[number];
export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];
export type PostStatus = (typeof postStatusEnum.enumValues)[number];
export type EarningKind = (typeof earningKindEnum.enumValues)[number];
export type PayoutStatus = (typeof payoutStatusEnum.enumValues)[number];

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull().default("influencer"),
    status: userStatusEnum("status").notNull().default("invited"),
    passwordHash: text("password_hash"),
    timezone: text("timezone").notNull().default("UTC"),
    avatarUrl: text("avatar_url"),
    // payouts
    payoutMethod: payoutMethodEnum("payout_method"),
    paypalEmail: text("paypal_email"),
    stripeAccountId: text("stripe_account_id"),
    stripeReady: boolean("stripe_ready").notNull().default(false),
    stripeCountry: text("stripe_country"),
    // invite / password reset (single-use, hashed)
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    // reminder de-duplication: "YYYY-MM-DDTHH" in the user's timezone
    lastReminderSlot: text("last_reminder_slot"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_invite_token_unique").on(t.inviteTokenHash),
    uniqueIndex("users_stripe_account_unique").on(t.stripeAccountId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    // sha256(token) — the raw token only lives in the user's httpOnly cookie
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* -------------------------------------------------------------- campaigns */

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: campaignStatusEnum("status").notNull().default("active"),
  // money is always stored as integer cents
  cpmCents: integer("cpm_cents").notNull().default(0), // paid per 1,000 views
  flatFeeCents: integer("flat_fee_cents").notNull().default(0), // paid per approved video
  maxPerPostCents: integer("max_per_post_cents"), // optional cap per video (flat + views)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const campaignMembers = pgTable(
  "campaign_members",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] }), index("campaign_members_user_idx").on(t.userId)],
);

/* -------------------------------------------------------- social accounts */

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    handle: text("handle").notNull(), // normalized: lowercase, no "@"
    followers: integer("followers").notNull().default(0),
    goalPerDay: integer("goal_per_day").notNull().default(1),
    avatarUrl: text("avatar_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("social_accounts_platform_handle_unique").on(t.platform, t.handle),
    index("social_accounts_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ posts */

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    status: postStatusEnum("status").notNull().default("pending"),
    views: integer("views").notNull().default(0),
    viewsUpdatedAt: timestamp("views_updated_at", { withTimezone: true }),
    // campaign rates are frozen when the video is approved, so later rate changes
    // never rewrite what was already promised for this video
    rateCpmCents: integer("rate_cpm_cents"),
    rateFlatFeeCents: integer("rate_flat_fee_cents"),
    rateMaxCents: integer("rate_max_cents"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("posts_url_unique").on(t.url),
    index("posts_user_created_idx").on(t.userId, t.createdAt),
    index("posts_status_idx").on(t.status),
    index("posts_campaign_idx").on(t.campaignId),
  ],
);

/* ---------------------------------------------------------------- payouts */

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    method: payoutMethodEnum("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    status: payoutStatusEnum("status").notNull().default("requested"),
    destination: text("destination"), // acct_… or PayPal email, frozen at request time
    providerRef: text("provider_ref"), // Stripe transfer id / PayPal payout_item_id
    providerBatchId: text("provider_batch_id"), // PayPal payout_batch_id
    failureReason: text("failure_reason"),
    requestedById: uuid("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [index("payouts_user_status_idx").on(t.userId, t.status), index("payouts_status_idx").on(t.status)],
);

/* ------------------------------------------------- earnings (the ledger) */

export const earnings = pgTable(
  "earnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "restrict" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    kind: earningKindEnum("kind").notNull(),
    amountCents: integer("amount_cents").notNull(), // signed: negative = correction
    note: text("note"),
    maturesAt: timestamp("matures_at", { withTimezone: true }).notNull(),
    payoutId: uuid("payout_id").references(() => payouts.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("earnings_user_payout_idx").on(t.userId, t.payoutId),
    index("earnings_post_idx").on(t.postId),
    index("earnings_payout_idx").on(t.payoutId),
  ],
);

/* ---------------------------------------------------------- notifications */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

/* --------------------------------------------------------------- settings */

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  holdHours: integer("hold_hours").notNull().default(48),
  minPayoutCents: integer("min_payout_cents").notNull().default(1000),
  reminderHours: text("reminder_hours").notNull().default("12,18,21"),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ many }) => ({
  socialAccounts: many(socialAccounts),
  posts: many(posts),
  earnings: many(earnings),
  payouts: many(payouts),
  memberships: many(campaignMembers),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  members: many(campaignMembers),
  posts: many(posts),
}));

export const campaignMembersRelations = relations(campaignMembers, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignMembers.campaignId], references: [campaigns.id] }),
  user: one(users, { fields: [campaignMembers.userId], references: [users.id] }),
}));

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  user: one(users, { fields: [socialAccounts.userId], references: [users.id] }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  user: one(users, { fields: [posts.userId], references: [users.id] }),
  socialAccount: one(socialAccounts, { fields: [posts.socialAccountId], references: [socialAccounts.id] }),
  campaign: one(campaigns, { fields: [posts.campaignId], references: [campaigns.id] }),
  earnings: many(earnings),
}));

export const earningsRelations = relations(earnings, ({ one }) => ({
  user: one(users, { fields: [earnings.userId], references: [users.id] }),
  campaign: one(campaigns, { fields: [earnings.campaignId], references: [campaigns.id] }),
  post: one(posts, { fields: [earnings.postId], references: [posts.id] }),
  payout: one(payouts, { fields: [earnings.payoutId], references: [payouts.id] }),
}));

export const payoutsRelations = relations(payouts, ({ one, many }) => ({
  user: one(users, { fields: [payouts.userId], references: [users.id] }),
  earnings: many(earnings),
}));

export type User = typeof users.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Earning = typeof earnings.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
