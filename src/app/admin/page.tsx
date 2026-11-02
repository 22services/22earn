import type { Metadata } from "next";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { ArrowRight, Flame, Megaphone } from "lucide-react";
import Link from "next/link";
import { nudgeAction } from "@/app/admin/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Avatar, Card, cn, Notice, PageTitle, SectionTitle, Select, Stat, Textarea } from "@/components/ui";
import { db } from "@/db";
import { payouts, posts } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { env, providers } from "@/lib/env";
import { getAllGoalSnapshots } from "@/lib/goals";
import { getBalancesByUser } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { timeAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  await requireAdmin();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [balances, goals, [pendingVideos], [requests], [paidMonth]] = await Promise.all([
    getBalancesByUser(),
    getAllGoalSnapshots(),
    db.select({ n: count() }).from(posts).where(eq(posts.status, "pending")),
    db.select({ n: count(), total: sql`coalesce(sum(${payouts.amountCents}),0)`.mapWith(Number) }).from(payouts).where(eq(payouts.status, "requested")),
    db
      .select({ total: sql`coalesce(sum(${payouts.amountCents}),0)`.mapWith(Number) })
      .from(payouts)
      .where(and(eq(payouts.status, "paid"), gte(payouts.paidAt, monthStart))),
  ]);

  let maturing = 0;
  let available = 0;
  for (const b of balances.values()) {
    maturing += b.maturingCents;
    available += Math.max(0, b.availableCents);
  }

  const rows = goals
    .map((g) => ({ ...g, left: Math.max(0, g.snapshot.dailyGoal - g.snapshot.todayCount) }))
    .sort((a, b) => b.left - a.left || a.snapshot.streak - b.snapshot.streak || a.user.name.localeCompare(b.user.name));
  const onTrack = rows.filter((r) => r.snapshot.dailyGoal > 0 && r.left === 0).length;
  const withGoal = rows.filter((r) => r.snapshot.dailyGoal > 0).length;

  const warnings = [
    !providers.stripe() && "Stripe isn't configured (STRIPE_SECRET_KEY).",
    !providers.paypal() && "PayPal isn't configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).",
    !providers.push() && "Push reminders are off (VAPID keys missing) — creators won't get nudges on their phone.",
    !env.cronSecret && "CRON_SECRET is not set — automatic posting reminders are disabled.",
  ].filter(Boolean) as string[];

  return (
    <div className="animate-rise">
      <PageTitle>Dashboard</PageTitle>

      {warnings.length ? (
        <Notice tone="warning" className="mb-5">
          <ul className="list-inside list-disc space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <Link href="/admin/settings" className="mt-1 inline-block underline underline-offset-2">
            See setup
          </Link>
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Owed to creators" value={formatMoney(maturing + available)} hint={`${formatMoney(maturing)} still maturing`} />
        <Stat label="Payable now" value={formatMoney(available)} tone={available > 0 ? "accent" : undefined} hint="matured, not withdrawn" />
        <Stat label="Paid this month" value={formatMoney(paidMonth?.total ?? 0)} />
        <Stat label="Posting goal today" value={`${onTrack}/${withGoal}`} hint="creators on track" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Link href="/admin/videos">
          <Card className="flex items-center justify-between px-5 py-4 transition hover:bg-surface-2">
            <div>
              <p className="text-sm text-muted">Videos to review</p>
              <p className="tabular text-xl font-bold">{pendingVideos?.n ?? 0}</p>
            </div>
            <ArrowRight className="size-5 text-muted" />
          </Card>
        </Link>
        <Link href="/admin/payouts">
          <Card className={cn("flex items-center justify-between px-5 py-4 transition hover:bg-surface-2", (requests?.n ?? 0) > 0 && "border-accent/40")}>
            <div>
              <p className="text-sm text-muted">Withdrawal requests</p>
              <p className="tabular text-xl font-bold">
                {requests?.n ?? 0} <span className="text-sm font-normal text-muted">· {formatMoney(requests?.total ?? 0)}</span>
              </p>
            </div>
            <ArrowRight className="size-5 text-muted" />
          </Card>
        </Link>
      </div>

      <SectionTitle>Posting today</SectionTitle>
      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          No active creators yet. <Link href="/admin/influencers" className="text-fg underline underline-offset-2">Invite your first creator</Link>.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-subtle">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">Creator</th>
                <th className="px-4 py-3 font-medium">Today</th>
                <th className="px-4 py-3 font-medium">Last 7 days</th>
                <th className="px-4 py-3 font-medium">Streak</th>
                <th className="px-4 py-3 font-medium">Last post</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ user, snapshot, left }) => (
                <tr key={user.id}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/influencers/${user.id}`} className="flex items-center gap-2.5 hover:underline">
                      <Avatar name={user.name} size={30} />
                      <span className="font-medium">{user.name}</span>
                    </Link>
                  </td>
                  <td className="tabular px-4 py-3">
                    {snapshot.dailyGoal === 0 ? (
                      <span className="text-subtle">no goal</span>
                    ) : (
                      <span className={left === 0 ? "font-semibold text-accent" : "text-fg"}>
                        {snapshot.todayCount}/{snapshot.dailyGoal}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {snapshot.last7.map((d) => (
                        <span key={d.key} title={`${d.key}: ${d.count}`} className={cn("size-3 rounded-full", d.met ? "bg-accent" : d.count > 0 ? "bg-fg/40" : "bg-surface-3")} />
                      ))}
                    </div>
                  </td>
                  <td className="tabular px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <Flame className={cn("size-3.5", snapshot.streak ? "text-orange-400" : "text-subtle")} />
                      {snapshot.streak}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{snapshot.lastPostAt ? timeAgo(snapshot.lastPostAt) : "never"}</td>
                  <td className="px-4 py-3 text-right">
                    {left > 0 ? (
                      <ActionForm action={nudgeAction} showMessage={false}>
                        <input type="hidden" name="target" value={user.id} />
                        <input
                          type="hidden"
                          name="message"
                          value={`Hey ${user.name.split(" ")[0]}, ${left} more video${left > 1 ? "s" : ""} today to hit your goal 💪`}
                        />
                        <SubmitButton size="sm" variant="subtle" pendingText="Sent">
                          Nudge
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <Megaphone className="size-4" /> Message creators
        </span>
      </SectionTitle>
      <Card className="p-5">
        <ActionForm action={nudgeAction} className="grid gap-3 md:grid-cols-[240px_1fr_auto] md:items-start" resetOnSuccess>
          <Select name="target" defaultValue="behind" aria-label="Recipients">
            <option value="behind">Behind on today&apos;s goal</option>
            <option value="all">All creators</option>
          </Select>
          <Textarea name="message" required maxLength={200} placeholder="New campaign is live — 3 clips today and there's a $20 bonus 🔥" className="min-h-11" />
          <SubmitButton pendingText="Sending…">Send push</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
