import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ArrowRight, Flame, Plus, Target } from "lucide-react";
import Link from "next/link";
import { markNotificationsReadAction } from "@/app/app/actions";
import { CampaignPill } from "@/components/campaign-pill";
import { SubmitButton } from "@/components/forms";
import { PlatformIcon } from "@/components/platform-icon";
import { PushToggle } from "@/components/push-toggle";
import { Avatar, ButtonLink, Card, cn, EmptyState, Notice, ProgressBar, SectionTitle } from "@/components/ui";
import { db } from "@/db";
import { notifications, socialAccounts } from "@/db/schema";
import { requireInfluencer } from "@/lib/auth";
import { getCampaignContext } from "@/lib/campaign-context";
import { env, providers } from "@/lib/env";
import { getGoalSnapshot } from "@/lib/goals";
import { getBalance } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { localHour, timeAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Today" };

const weekday = (key: string) => new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

export default async function TodayPage() {
  const user = await requireInfluencer();
  const [snap, accounts, balance, inbox, ctx] = await Promise.all([
    getGoalSnapshot(user.id, user.timezone),
    db.select().from(socialAccounts).where(eq(socialAccounts.userId, user.id)).orderBy(desc(socialAccounts.followers)),
    getBalance(user.id),
    db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(6),
    getCampaignContext(user.id),
  ]);
  const unread = inbox.filter((n) => !n.readAt);
  const hour = localHour(new Date(), user.timezone);
  const greeting = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const left = Math.max(0, snap.dailyGoal - snap.todayCount);
  const done = snap.dailyGoal > 0 && left === 0;
  const pct = snap.dailyGoal > 0 ? Math.min(1, snap.todayCount / snap.dailyGoal) : 0;
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <div className="animate-rise">
      <div className="flex items-center justify-between">
        <CampaignPill campaigns={ctx.campaigns} selectedId={ctx.selected?.id ?? null} />
      </div>
      <h1 className="mt-5 text-[28px] font-bold tracking-tight">
        {greeting}, {user.name.split(" ")[0]}
      </h1>

      {ctx.campaigns.length === 0 ? (
        <Notice tone="warning" className="mt-4">
          You haven&apos;t been added to a campaign yet. The admin will add you soon.
        </Notice>
      ) : null}

      {/* ------------------------------------------------- today's goal */}
      <Card className={cn("mt-4 overflow-hidden p-5", done && "border-accent/40 shadow-[var(--shadow-glow)]")}>
        <div className="flex items-center gap-5">
          <div className="relative size-[84px] shrink-0">
            <svg viewBox="0 0 80 80" className="size-full -rotate-90">
              <circle cx="40" cy="40" r={R} fill="none" stroke="var(--color-surface-3)" strokeWidth="8" />
              <circle
                cx="40"
                cy="40"
                r={R}
                fill="none"
                stroke={done ? "var(--color-accent)" : "var(--color-fg)"}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - pct)}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <p className="tabular text-lg font-bold">
                {snap.todayCount}
                <span className="text-sm font-medium text-muted">/{snap.dailyGoal}</span>
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-muted">Today&apos;s goal</p>
            <p className="mt-0.5 text-lg font-semibold leading-snug">
              {snap.dailyGoal === 0
                ? "No goal set yet"
                : done
                  ? "Goal reached — legend 🎉"
                  : `${left} more video${left > 1 ? "s" : ""} to post`}
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm">
              <Flame className={cn("size-4", snap.streak > 0 ? "text-orange-400" : "text-subtle")} />
              <span className={snap.streak > 0 ? "text-fg" : "text-muted"}>
                {snap.streak > 0 ? `${snap.streak}-day streak` : "Start a streak today"}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-1.5">
          {snap.last7.map((d, i) => (
            <div key={d.key} className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "grid size-8 place-items-center rounded-full text-xs font-semibold",
                  d.met ? "bg-accent text-accent-fg" : d.count > 0 ? "bg-surface-3 text-fg" : "bg-surface-2 text-subtle",
                  i === 6 && !d.met && "ring-1 ring-line-strong",
                )}
                title={`${d.key}: ${d.count} video(s)`}
              >
                {d.count}
              </div>
              <span className={cn("text-[11px]", i === 6 ? "text-fg" : "text-subtle")}>{weekday(d.key)}</span>
            </div>
          ))}
        </div>

        <ButtonLink href="/app/videos/new" size="lg" className="mt-5 w-full" variant={done ? "outline" : "primary"}>
          <Plus className="size-5" /> {done ? "Post one more" : "Submit a video"}
        </ButtonLink>
      </Card>

      {providers.push() ? <PushToggle publicKey={env.push.publicKey} variant="prompt" /> : null}

      {/* ---------------------------------------------- per-account goals */}
      <SectionTitle action={<Link href="/app/accounts" className="text-sm text-muted hover:text-fg">Manage</Link>}>Your accounts today</SectionTitle>
      {accounts.length === 0 ? (
        <EmptyState icon={<Target className="size-6" />} title="Add your social accounts" action={<ButtonLink href="/app/accounts/new" size="sm">Add an account</ButtonLink>}>
          Add your TikTok, Instagram or YouTube accounts to get daily posting goals.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {accounts.map((a) => {
            const count = snap.todayByAccount.get(a.id) ?? 0;
            return (
              <Link key={a.id} href={`/app/videos/new?account=${a.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2">
                <Avatar name={a.handle} src={a.avatarUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[15px] font-medium">@{a.handle}</p>
                    <PlatformIcon platform={a.platform} className="size-3.5 text-muted" />
                  </div>
                  <ProgressBar value={count} max={a.goalPerDay} className="mt-2" />
                </div>
                <p className={cn("tabular shrink-0 text-sm font-semibold", count >= a.goalPerDay ? "text-accent" : "text-muted")}>
                  {count}/{a.goalPerDay}
                </p>
              </Link>
            );
          })}
        </Card>
      )}

      {/* --------------------------------------------------- money glance */}
      <Link href="/app/earnings" className="mt-4 block">
        <Card className="flex items-center justify-between px-5 py-4 transition hover:bg-surface-2">
          <div>
            <p className="text-[13px] text-muted">Pending earnings</p>
            <p className="tabular mt-0.5 text-xl font-bold">{formatMoney(balance.pendingCents)}</p>
          </div>
          <ArrowRight className="size-5 text-muted" />
        </Card>
      </Link>

      {/* ---------------------------------------------------------- inbox */}
      {inbox.length > 0 ? (
        <>
          <SectionTitle
            action={
              unread.length > 0 ? (
                <form action={markNotificationsReadAction}>
                  <SubmitButton variant="ghost" size="sm" className="h-7 px-2 text-muted">
                    Mark all read
                  </SubmitButton>
                </form>
              ) : null
            }
          >
            Messages {unread.length > 0 ? <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-accent-fg">{unread.length}</span> : null}
          </SectionTitle>
          <Card className="divide-y divide-line">
            {inbox.map((n) => (
              <Link key={n.id} href={n.url ?? "/app"} className="flex gap-3 px-4 py-3.5 hover:bg-surface-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="mt-0.5 text-xs text-subtle">{timeAgo(n.createdAt)}</p>
                </div>
              </Link>
            ))}
          </Card>
        </>
      ) : null}
    </div>
  );
}
