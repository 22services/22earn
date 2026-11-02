# 22earn — App spec (source of truth)

> Brief: rebuild the "Post & Earn" influencer-earnings experience from the reference
> screenshot (Revclip) as **our own web app**, so influencers can follow the money the owner
> gives them and are **pushed to post often**, while the owner manages everything in the same
> app with **admin rights** vs **influencer rights**. No App Store for now: a **web app ready to
> deploy**. Replace Whop with **Stripe _and_ PayPal** (both).

## Roles

| Role | Can |
|---|---|
| **Admin** (owner) | Everything: invite/disable influencers, campaigns & rates, posting goals, review videos, enter views, add bonuses/adjustments, approve/send payouts (Stripe or PayPal), nudge, settings |
| **Influencer** | Only their own data: today's goals & streak, submit videos, earnings, social accounts, payout method, withdraw request, notifications |

Every server action / route re-checks the role server-side; an influencer can never read or
write another user's rows.

## Entities

- **User** — email, name, role (admin/influencer), status (invited/active/disabled), timezone,
  payout method (stripe/paypal), PayPal email, Stripe connected account id + readiness.
- **Campaign** — name ("Summer Clips"), brief, status, rate per 1,000 views, flat fee per approved
  video, optional cap per video. Influencers are members of campaigns.
- **Social account** — platform (TikTok / Instagram / YouTube), handle, followers, avatar,
  **goal: N videos/day** (set by admin).
- **Video (post)** — URL, account, campaign, status (pending/approved/rejected), views.
- **Earning** (append-only ledger, integer cents) — views / flat fee / bonus / adjustment,
  `maturesAt` (hold period, default 48 h), linked to a payout once paid.
- **Payout** — method (stripe/paypal), amount, status (requested → processing → paid | failed |
  canceled), provider references.
- **Notification**, **Push subscription**, **Settings** (hold hours, min payout, reminder hours).

## Screens

### Influencer (mobile-first, bottom tab bar)
1. **Today** — daily goal progress per account, streak, "Submit a video" CTA, messages from admin.
2. **Videos** — submit a video link; list with status, views, earned.
3. **Earnings** *(screenshot)* — campaign pill, **Pending** balance, "including X maturing (48 h)",
   "How does it work?", **Sent to Stripe/PayPal** total + link to the provider, **Withdraw**
   button, **Transfer history** grouped by month with ✓ status.
4. **My accounts** *(screenshot)* — avatar, @handle + platform icon, followers,
   🎯 "Goal: N videos/day" (+ today's progress).
5. **Settings** — profile, payout method (Stripe Connect onboarding or PayPal email),
   push notifications, logout.

### Admin
Dashboard · Influencers (+ detail) · Campaigns (+ detail) · Videos review · Payouts · Settings.

## Key flows
- First run: `/setup` creates the owner (admin) account when the DB is empty.
- Admin invites influencer → shareable link → influencer sets password → logged in.
- Influencer submits video → admin approves (flat fee earning) → admin enters views → views
  earning (rate × views / 1000, capped) → matures after hold → available.
- Withdraw: influencer requests available balance → admin approves → money sent via
  **Stripe transfer** (to their Stripe Express account) or **PayPal Payout** (to PayPal email).
  Admin can also "Pay all available" in one click. Failures put the money back in the balance.
- Push to post: web-push reminders at configured local hours when today's goal isn't met,
  streaks, and admin "nudge" messages.

## Non-goals (for now)
- App Store / Play Store builds.
- Automatic scraping of TikTok/Instagram/YouTube views (admin enters views; API sync later).
- Email sending (invite links are copied and shared by the admin).
- Charging customers / brands (the app only pays creators out).

## Fidelity contract (verified)

| Requirement | Status | How it was verified |
|---|---|---|
| Earnings screen like the screenshot (pending, maturing, sent, withdraw, history by month) | ✅ | `/app/earnings` — Playwright screenshots + e2e flow |
| My accounts screen like the screenshot (handle, platform icon, followers, goal/day) | ✅ | `/app/accounts` |
| Campaign pill ("Summer Clips") | ✅ | global switcher on every creator tab, filters earnings/videos |
| Admin rights vs influencer rights in the same app | ✅ | server-side role checks; e2e: creator → `/admin` is redirected |
| Influencers follow the earnings the admin gives them | ✅ | views/fee/bonus ledger, "Earnings activity", notifications |
| Pushed to post often | ✅ | daily goals per account, streaks, 7-day row, web-push reminders (cron), admin nudges |
| Stripe payouts | ✅ | Connect Express onboarding + transfers + webhooks (simulated end-to-end; real keys needed for live) |
| PayPal payouts | ✅ | Payouts API + verified webhooks + status sync (simulated end-to-end; real keys needed for live) |
| Web app ready to deploy | ✅ | Docker Compose (Postgres + Caddy HTTPS + cron + backups), Vercel path; prod build tested on PostgreSQL 16 |
| Login: setup / login / invite / logout | ✅ | e2e on embedded DB and production build |
| Database: schema, migrations, access rules, CRUD | ✅ | 21 tests on PGlite **and** real PostgreSQL |

Not built on purpose (non-goals above): store apps, automatic view scraping, email sending.
