import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { ChevronLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addEarningAction,
  issueLinkAction,
  nudgeAction,
  setGoalAction,
  setMembershipsAction,
  setUserStatusAction,
  updateUserAction,
} from "@/app/admin/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PayoutIcon, PlatformIcon, platformMeta } from "@/components/platform-icon";
import { payoutStatusTone, postStatusTone } from "@/components/status";
import { Avatar, Badge, Card, cn, Field, Input, Notice, SectionTitle, Select, Stat } from "@/components/ui";
import { db } from "@/db";
import { campaignMembers, campaigns, payouts, posts, socialAccounts, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { getGoalSnapshot } from "@/lib/goals";
import { getBalance, listEarnings } from "@/lib/ledger";
import { formatCompact, formatMoney, formatNumber } from "@/lib/money";
import { methodLabel, payoutReadiness } from "@/lib/payouts";
import { formatDate, formatDateTime, timeUntil } from "@/lib/time";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Creator" };

export default async function InfluencerDetail({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) notFound();

  const [balance, accounts, memberships, allCampaigns, recentPosts, ledger, payoutRows, snap] = await Promise.all([
    getBalance(user.id),
    db.select().from(socialAccounts).where(eq(socialAccounts.userId, user.id)).orderBy(desc(socialAccounts.followers)),
    db.select().from(campaignMembers).where(eq(campaignMembers.userId, user.id)),
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)),
    db
      .select({ post: posts, campaign: campaigns.name, handle: socialAccounts.handle, platform: socialAccounts.platform })
      .from(posts)
      .innerJoin(campaigns, eq(campaigns.id, posts.campaignId))
      .leftJoin(socialAccounts, eq(socialAccounts.id, posts.socialAccountId))
      .where(eq(posts.userId, user.id))
      .orderBy(desc(posts.createdAt))
      .limit(15),
    listEarnings(user.id, { limit: 30 }),
    db.select().from(payouts).where(and(eq(payouts.userId, user.id))).orderBy(desc(payouts.requestedAt)).limit(20),
    getGoalSnapshot(user.id, user.timezone),
  ]);
  const memberOf = new Set(memberships.map((m) => m.campaignId));
  const readiness = payoutReadiness(user);
  const isSelf = admin.id === user.id;

  return (
    <div className="animate-rise">
      <Link href="/admin/influencers" className="-ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> Creators
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Avatar name={user.name} src={user.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {user.name}
            <Badge tone={user.status === "active" ? "success" : user.status === "invited" ? "info" : "danger"}>{user.status}</Badge>
            {user.role === "admin" ? <Badge tone="accent">admin</Badge> : null}
          </h1>
          <p className="text-sm text-muted">
            {user.email} · {user.timezone} · joined {formatDate(user.createdAt)}
          </p>
        </div>
        {!isSelf ? (
          <form action={setUserStatusAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="enable" value={user.status === "disabled" ? "true" : "false"} />
            <SubmitButton
              size="sm"
              variant={user.status === "disabled" ? "subtle" : "danger"}
              confirm={user.status === "disabled" ? undefined : `Disable ${user.name}? They'll be signed out and can't log in. Their money stays in the ledger.`}
            >
              {user.status === "disabled" ? "Enable account" : "Disable"}
            </SubmitButton>
          </form>
        ) : null}
      </div>

      {user.status !== "disabled" ? (
        <Card className="mt-4 p-4">
          <ActionForm action={issueLinkAction} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="userId" value={user.id} />
            <p className="text-sm text-muted">
              {user.status === "invited" ? "Hasn't joined yet. Create a fresh invite link to send again." : "Forgot their password? Create a reset link."}
            </p>
            <SubmitButton size="sm" variant="subtle" pendingText="Creating…">
              {user.status === "invited" ? "New invite link" : "Password reset link"}
            </SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      {/* ------------------------------------------------------ money */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Pending" value={formatMoney(balance.pendingCents)} />
        <Stat label="Maturing" value={formatMoney(balance.maturingCents)} hint={balance.nextMaturityAt ? `next ${timeUntil(balance.nextMaturityAt)}` : undefined} />
        <Stat label="Payable now" value={formatMoney(Math.max(0, balance.availableCents))} tone={balance.availableCents > 0 ? "accent" : undefined} />
        <Stat label="In transit" value={formatMoney(balance.inTransitCents)} />
        <Stat label="Paid" value={formatMoney(balance.paidCents)} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <p className="font-semibold">Give money</p>
          <p className="mt-0.5 text-xs text-muted">Bonuses and corrections go straight into their ledger (negative = remove money).</p>
          <ActionForm action={addEarningAction} className="mt-4 grid gap-3 sm:grid-cols-2" resetOnSuccess>
            <input type="hidden" name="userId" value={user.id} />
            <Field label="Type">
              <Select name="kind" defaultValue="bonus" className="mt-1.5">
                <option value="bonus">Bonus</option>
                <option value="adjustment">Adjustment (+/−)</option>
              </Select>
            </Field>
            <Field label={`Amount (${env.currency})`}>
              <Input name="amount" inputMode="decimal" required placeholder="25.00" className="mt-1.5" />
            </Field>
            <Field label="Campaign (optional)">
              <Select name="campaignId" defaultValue="" className="mt-1.5">
                <option value="">No campaign</option>
                {allCampaigns.filter((c) => memberOf.has(c.id)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note (they see it)">
              <Input name="note" maxLength={200} placeholder="Top performer of the week" className="mt-1.5" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
              <input type="checkbox" name="applyHold" className="accent-[var(--color-accent)]" /> Apply the maturing period (otherwise payable immediately)
            </label>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Adding…">Add to ledger</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card className="p-5">
          <p className="font-semibold">Payout details</p>
          <div className="mt-3 space-y-2 text-sm">
            <p className="flex items-center justify-between gap-3">
              <span className="text-muted">Default method</span>
              <span className="inline-flex items-center gap-1.5">
                {user.payoutMethod ? <PayoutIcon method={user.payoutMethod} /> : null}
                {user.payoutMethod ? methodLabel(user.payoutMethod) : "Not set"}
              </span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-muted">PayPal email</span>
              <span className="truncate">{user.paypalEmail ?? "—"}</span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-muted">Stripe account</span>
              <span className="truncate font-mono text-xs">
                {user.stripeAccountId ?? "—"} {user.stripeAccountId ? (user.stripeReady ? <Badge tone="success">ready</Badge> : <Badge tone="warning">onboarding</Badge>) : null}
              </span>
            </p>
          </div>
          {!readiness.ready ? <Notice tone="warning" className="mt-3">{readiness.reason}</Notice> : null}

          <p className="mt-5 font-semibold">Send a nudge</p>
          <ActionForm action={nudgeAction} className="mt-2 flex gap-2" resetOnSuccess>
            <input type="hidden" name="target" value={user.id} />
            <Input name="message" required maxLength={200} placeholder={`${snap.todayCount}/${snap.dailyGoal} today — let's go 🔥`} />
            <SubmitButton variant="subtle" pendingText="…">
              Send
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>

      {/* --------------------------------------------------- accounts */}
      <SectionTitle>
        Accounts & daily goals <span className="ml-2 text-sm font-normal text-muted">today {snap.todayCount}/{snap.dailyGoal} · 🔥 {snap.streak}-day streak</span>
      </SectionTitle>
      {accounts.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No social accounts added yet.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {accounts.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-center gap-3">
                <Avatar name={a.handle} src={a.avatarUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <a href={platformMeta[a.platform].profileUrl(a.handle)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-medium hover:underline">
                    @{a.handle} <PlatformIcon platform={a.platform} className="size-3.5" />
                  </a>
                  <p className="tabular text-xs text-muted">
                    {formatNumber(a.followers)} followers · {snap.todayByAccount.get(a.id) ?? 0}/{a.goalPerDay} today
                  </p>
                </div>
              </div>
              <ActionForm action={setGoalAction} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="accountId" value={a.id} />
                <Field label="Goal (videos/day)" className="w-36">
                  <Input name="goalPerDay" type="number" min={0} max={50} defaultValue={a.goalPerDay} className="mt-1.5" />
                </Field>
                <Field label="Followers" className="flex-1">
                  <Input name="followers" type="number" min={0} defaultValue={a.followers} className="mt-1.5" />
                </Field>
                <SubmitButton variant="subtle" pendingText="…">
                  Save
                </SubmitButton>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}

      {/* -------------------------------------------- campaigns + profile */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <p className="font-semibold">Campaigns</p>
          {allCampaigns.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No campaigns yet. <Link href="/admin/campaigns" className="text-fg underline">Create one</Link>.
            </p>
          ) : (
            <ActionForm action={setMembershipsAction} className="mt-3">
              <input type="hidden" name="userId" value={user.id} />
              <div className="flex flex-wrap gap-2">
                {allCampaigns.map((c) => (
                  <label key={c.id} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm has-[:checked]:border-accent/60">
                    <input type="checkbox" name="campaignId" value={c.id} defaultChecked={memberOf.has(c.id)} className="accent-[var(--color-accent)]" />
                    {c.name}
                    {c.status !== "active" ? <span className="text-xs text-subtle">({c.status})</span> : null}
                  </label>
                ))}
              </div>
              <SubmitButton size="sm" variant="subtle" className="mt-3" pendingText="Saving…">
                Save campaigns
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card className="p-5">
          <p className="font-semibold">Profile</p>
          <ActionForm action={updateUserAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="userId" value={user.id} />
            <Field label="Name">
              <Input name="name" defaultValue={user.name} required className="mt-1.5" />
            </Field>
            <Field label="Email (login)">
              <Input name="email" type="email" defaultValue={user.email} required className="mt-1.5" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton size="sm" variant="subtle" pendingText="Saving…">
                Save profile
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>

      {/* ------------------------------------------------------ videos */}
      <SectionTitle action={<Link href="/admin/videos?status=all" className="text-sm text-muted hover:text-fg">All videos</Link>}>Recent videos</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <tbody className="divide-y divide-line">
            {recentPosts.map(({ post, campaign, handle, platform }) => (
              <tr key={post.id}>
                <td className="px-4 py-3">
                  <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                    {platform ? <PlatformIcon platform={platform} className="size-3.5" /> : null}@{handle ?? "removed"} <ExternalLink className="size-3 text-subtle" />
                  </a>
                </td>
                <td className="px-4 py-3 text-muted">{campaign}</td>
                <td className="px-4 py-3">
                  <Badge tone={postStatusTone[post.status]}>{post.status}</Badge>
                </td>
                <td className="tabular px-4 py-3 text-muted">{formatCompact(post.views)} views</td>
                <td className="px-4 py-3 text-right text-muted">{formatDateTime(post.createdAt)}</td>
              </tr>
            ))}
            {recentPosts.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-muted">No videos yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>

      {/* ------------------------------------------------------ ledger */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <SectionTitle>Ledger</SectionTitle>
          <Card className="divide-y divide-line">
            {ledger.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{e.note ?? e.kind}</p>
                  <p className="truncate text-xs text-subtle">
                    {e.kind.replace("_", " ")} · {formatDateTime(e.createdAt)}
                    {e.campaignName ? ` · ${e.campaignName}` : ""}
                    {e.payoutStatus ? ` · ${e.payoutStatus}` : e.maturesAt > new Date() ? ` · matures ${timeUntil(e.maturesAt)}` : " · available"}
                  </p>
                </div>
                <span className={cn("tabular shrink-0 font-semibold", e.amountCents < 0 && "text-danger")}>{formatMoney(e.amountCents, { sign: true })}</span>
              </div>
            ))}
            {ledger.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</p> : null}
          </Card>
        </div>
        <div>
          <SectionTitle action={<Link href="/admin/payouts" className="text-sm text-muted hover:text-fg">Payouts</Link>}>Transfers</SectionTitle>
          <Card className="divide-y divide-line">
            {payoutRows.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5">
                    <PayoutIcon method={p.method} className="size-3.5" /> {formatDate(p.paidAt ?? p.requestedAt)}
                    <Badge tone={payoutStatusTone[p.status]}>{p.status}</Badge>
                  </p>
                  {p.failureReason ? <p className="truncate text-xs text-subtle">{p.failureReason}</p> : null}
                </div>
                <span className="tabular shrink-0 font-semibold">{formatMoney(p.amountCents, { currency: p.currency })}</span>
              </div>
            ))}
            {payoutRows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">No transfers yet.</p> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
