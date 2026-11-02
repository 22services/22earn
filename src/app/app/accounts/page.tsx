import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { CampaignPill } from "@/components/campaign-pill";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar, ButtonLink, Card, cn, EmptyState, ProgressBar } from "@/components/ui";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { requireInfluencer } from "@/lib/auth";
import { getCampaignContext } from "@/lib/campaign-context";
import { getGoalSnapshot } from "@/lib/goals";
import { formatNumber } from "@/lib/money";

export const metadata: Metadata = { title: "My accounts" };

export default async function AccountsPage() {
  const user = await requireInfluencer();
  const [accounts, snap, ctx] = await Promise.all([
    db.select().from(socialAccounts).where(eq(socialAccounts.userId, user.id)).orderBy(desc(socialAccounts.followers)),
    getGoalSnapshot(user.id, user.timezone),
    getCampaignContext(user.id),
  ]);

  return (
    <div className="animate-rise">
      <CampaignPill campaigns={ctx.campaigns} selectedId={ctx.selected?.id ?? null} />
      <div className="mt-5 mb-5 flex items-end justify-between">
        <h1 className="text-[28px] font-bold tracking-tight">My accounts</h1>
        <ButtonLink href="/app/accounts/new" size="sm" variant="subtle">
          <Plus className="size-4" /> Add
        </ButtonLink>
      </div>

      {accounts.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="No accounts yet" action={<ButtonLink href="/app/accounts/new">Add an account</ButtonLink>}>
          Add the TikTok, Instagram and YouTube accounts you post from.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const today = snap.todayByAccount.get(a.id) ?? 0;
            return (
              <Link key={a.id} href={`/app/accounts/${a.id}`} className="block">
                <Card className="p-4 transition hover:bg-surface-2">
                  <div className="flex items-center gap-3.5">
                    <Avatar name={a.handle} src={a.avatarUrl} size={52} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[17px] font-semibold">@{a.handle}</p>
                        <PlatformIcon platform={a.platform} className="size-4" />
                      </div>
                      <p className="tabular text-sm text-muted">{formatNumber(a.followers)} followers</p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex items-center justify-between gap-3 text-sm">
                    <p className="text-muted">
                      🎯 Goal: <span className="text-fg">{a.goalPerDay} video{a.goalPerDay > 1 ? "s" : ""}/day</span>
                    </p>
                    <p className={cn("tabular text-xs font-semibold", today >= a.goalPerDay ? "text-accent" : "text-muted")}>
                      {today}/{a.goalPerDay} today
                    </p>
                  </div>
                  <ProgressBar value={today} max={a.goalPerDay} className="mt-2" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-4 px-1 text-center text-xs text-subtle">Daily goals are set by your manager.</p>
    </div>
  );
}
