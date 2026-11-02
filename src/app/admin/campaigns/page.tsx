import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Disclosure } from "@/components/disclosure";
import { CampaignForm } from "@/components/campaign-form";
import { Badge, Card, PageTitle, SectionTitle } from "@/components/ui";
import { db } from "@/db";
import { campaignMembers, campaigns, earnings, posts, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatCompact, formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  await requireAdmin();
  const [rows, members, videoStats, money, creators] = await Promise.all([
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)),
    db.select({ id: campaignMembers.campaignId, n: sql`count(*)`.mapWith(Number) }).from(campaignMembers).groupBy(campaignMembers.campaignId),
    db
      .select({ id: posts.campaignId, n: sql`count(*)`.mapWith(Number), views: sql`coalesce(sum(${posts.views}),0)`.mapWith(Number) })
      .from(posts)
      .where(eq(posts.status, "approved"))
      .groupBy(posts.campaignId),
    db.select({ id: earnings.campaignId, total: sql`coalesce(sum(${earnings.amountCents}),0)`.mapWith(Number) }).from(earnings).groupBy(earnings.campaignId),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "influencer"), eq(users.status, "active"))).orderBy(users.name),
  ]);
  const by = <T extends { id: string | null }>(list: T[]) => new Map(list.map((r) => [r.id, r]));
  const m = by(members);
  const v = by(videoStats);
  const e = by(money);

  return (
    <div className="animate-rise">
      <PageTitle>Campaigns</PageTitle>
      <Disclosure
        defaultOpen={rows.length === 0}
        summaryClassName="inline-flex cursor-pointer list-none items-center gap-2 rounded-2xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg hover:bg-accent-strong"
        summary={
          <>
            <Plus className="size-4" /> New campaign
          </>
        }
      >
        <Card className="mt-3 p-5">
          <CampaignForm currency={env.currency} creators={creators} />
        </Card>
      </Disclosure>

      <SectionTitle>All campaigns</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((c) => (
          <Link key={c.id} href={`/admin/campaigns/${c.id}`}>
            <Card className="h-full p-5 transition hover:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-lg font-semibold">{c.name}</p>
                <Badge tone={c.status === "active" ? "success" : c.status === "paused" ? "warning" : "neutral"}>{c.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                {[c.flatFeeCents ? `${formatMoney(c.flatFeeCents)}/video` : null, c.cpmCents ? `${formatMoney(c.cpmCents)} per 1K views` : null, c.maxPerPostCents ? `max ${formatMoney(c.maxPerPostCents)}` : null]
                  .filter(Boolean)
                  .join(" · ") || "No rate set"}
              </p>
              <div className="tabular mt-4 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-subtle">Creators</p>
                  <p className="font-semibold">{m.get(c.id)?.n ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-subtle">Videos · views</p>
                  <p className="font-semibold">
                    {v.get(c.id)?.n ?? 0} · {formatCompact(v.get(c.id)?.views ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-subtle">Earned</p>
                  <p className="font-semibold">{formatMoney(e.get(c.id)?.total ?? 0)}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {rows.length === 0 ? <Card className="p-6 text-sm text-muted">No campaigns yet.</Card> : null}
      </div>
    </div>
  );
}
