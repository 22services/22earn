import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { Disclosure } from "@/components/disclosure";
import { inviteUserAction } from "@/app/admin/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PayoutIcon } from "@/components/platform-icon";
import { Avatar, Badge, Card, Field, Input, PageTitle, SectionTitle, Select } from "@/components/ui";
import { db } from "@/db";
import { campaigns, socialAccounts, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getAllGoalSnapshots } from "@/lib/goals";
import { getBalancesByUser } from "@/lib/ledger";
import { formatCompact, formatMoney } from "@/lib/money";
import { payoutReadiness } from "@/lib/payouts";

export const metadata: Metadata = { title: "Creators" };

export default async function InfluencersPage() {
  await requireAdmin();
  const [people, accountStats, balances, goals, allCampaigns] = await Promise.all([
    db.select().from(users).orderBy(asc(users.role), asc(users.name)),
    db
      .select({
        userId: socialAccounts.userId,
        accounts: sql`count(*)`.mapWith(Number),
        followers: sql`coalesce(sum(${socialAccounts.followers}),0)`.mapWith(Number),
      })
      .from(socialAccounts)
      .groupBy(socialAccounts.userId),
    getBalancesByUser(),
    getAllGoalSnapshots(),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).where(eq(campaigns.status, "active")),
  ]);
  const statsBy = new Map(accountStats.map((s) => [s.userId, s]));
  const goalBy = new Map(goals.map((g) => [g.user.id, g.snapshot]));
  const creators = people.filter((p) => p.role === "influencer");
  const admins = people.filter((p) => p.role === "admin");

  return (
    <div className="animate-rise">
      <PageTitle>Creators</PageTitle>

      <Disclosure
        defaultOpen={creators.length === 0}
        summaryClassName="inline-flex cursor-pointer list-none items-center gap-2 rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg hover:bg-accent-strong"
        summary={
          <>
            <UserPlus className="size-4" /> Invite a creator
          </>
        }
      >
        <Card className="mt-3 p-5">
          <ActionForm action={inviteUserAction} className="grid gap-4 md:grid-cols-2" resetOnSuccess>
            <Field label="Name">
              <Input name="name" required placeholder="Alex Martin" className="mt-1.5" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required placeholder="alex@example.com" className="mt-1.5" />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="influencer" className="mt-1.5">
                <option value="influencer">Creator (influencer rights)</option>
                <option value="admin">Admin (full rights)</option>
              </Select>
            </Field>
            {allCampaigns.length ? (
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-muted">Campaigns</legend>
                <div className="flex flex-wrap gap-2">
                  {allCampaigns.map((c) => (
                    <label key={c.id} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm has-[:checked]:border-accent/60">
                      <input type="checkbox" name="campaignId" value={c.id} defaultChecked={allCampaigns.length === 1} className="accent-[var(--color-accent)]" />
                      {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="md:col-span-2">
              <SubmitButton pendingText="Creating…">Create invite link</SubmitButton>
              <p className="mt-2 text-xs text-subtle">You&apos;ll get a private link to send by WhatsApp, Instagram DM or email. They set their own password.</p>
            </div>
          </ActionForm>
        </Card>
      </Disclosure>

      <SectionTitle>{creators.length} creator{creators.length === 1 ? "" : "s"}</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">Creator</th>
              <th className="px-4 py-3 font-medium">Accounts</th>
              <th className="px-4 py-3 font-medium">Today</th>
              <th className="px-4 py-3 text-right font-medium">Pending</th>
              <th className="px-4 py-3 text-right font-medium">Payable</th>
              <th className="px-4 py-3 text-right font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Payout</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {creators.map((u) => {
              const s = statsBy.get(u.id);
              const b = balances.get(u.id);
              const g = goalBy.get(u.id);
              const ready = payoutReadiness(u);
              return (
                <tr key={u.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/influencers/${u.id}`} className="flex items-center gap-2.5">
                      <Avatar name={u.name} src={u.avatarUrl} size={34} />
                      <div className="min-w-0">
                        <p className="font-medium hover:underline">{u.name}</p>
                        <p className="truncate text-xs text-subtle">{u.email}</p>
                      </div>
                      {u.status !== "active" ? <Badge tone={u.status === "invited" ? "info" : "danger"}>{u.status}</Badge> : null}
                    </Link>
                  </td>
                  <td className="tabular px-4 py-3 text-muted">
                    {s ? `${s.accounts} · ${formatCompact(s.followers)} followers` : "—"}
                  </td>
                  <td className="tabular px-4 py-3">{g && g.dailyGoal > 0 ? <span className={g.todayCount >= g.dailyGoal ? "text-accent" : ""}>{g.todayCount}/{g.dailyGoal}</span> : <span className="text-subtle">—</span>}</td>
                  <td className="tabular px-4 py-3 text-right">{formatMoney((b?.maturingCents ?? 0) + (b?.availableCents ?? 0))}</td>
                  <td className="tabular px-4 py-3 text-right font-semibold">{formatMoney(Math.max(0, b?.availableCents ?? 0))}</td>
                  <td className="tabular px-4 py-3 text-right text-muted">{formatMoney(b?.paidCents ?? 0)}</td>
                  <td className="px-4 py-3">
                    {u.payoutMethod ? (
                      <span className="inline-flex items-center gap-1.5">
                        <PayoutIcon method={u.payoutMethod} />
                        {ready.ready ? <span className="text-xs text-muted">ready</span> : <Badge tone="warning">incomplete</Badge>}
                      </span>
                    ) : (
                      <span className="text-xs text-subtle">not set</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {creators.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No creators yet — invite your first one above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      <SectionTitle>Admins</SectionTitle>
      <Card className="divide-y divide-line">
        {admins.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <Avatar name={a.name} size={30} />
            <span className="font-medium">{a.name}</span>
            <span className="text-subtle">{a.email}</span>
            {a.status !== "active" ? <Badge tone="info">{a.status}</Badge> : null}
          </div>
        ))}
      </Card>
    </div>
  );
}
