import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Clapperboard, ExternalLink, Eye, Plus } from "lucide-react";
import { deletePendingVideoAction } from "@/app/app/actions";
import { CampaignPill } from "@/components/campaign-pill";
import { SubmitButton } from "@/components/forms";
import { PlatformIcon } from "@/components/platform-icon";
import { postStatusTone } from "@/components/status";
import { Badge, ButtonLink, Card, EmptyState, PageTitle } from "@/components/ui";
import { db } from "@/db";
import { campaigns, earnings, posts, socialAccounts } from "@/db/schema";
import { requireInfluencer } from "@/lib/auth";
import { getCampaignContext } from "@/lib/campaign-context";
import { env } from "@/lib/env";
import { formatCompact, formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Videos" };

export default async function VideosPage() {
  const user = await requireInfluencer();
  const ctx = await getCampaignContext(user.id);
  const conditions = [eq(posts.userId, user.id)];
  if (ctx.selected) conditions.push(eq(posts.campaignId, ctx.selected.id));
  const rows = await db
    .select({ post: posts, handle: socialAccounts.handle, platform: socialAccounts.platform, campaignName: campaigns.name })
    .from(posts)
    .leftJoin(socialAccounts, eq(socialAccounts.id, posts.socialAccountId))
    .innerJoin(campaigns, eq(campaigns.id, posts.campaignId))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(200);
  const earned = rows.length
    ? await db
        .select({ postId: earnings.postId, total: sql`sum(${earnings.amountCents})`.mapWith(Number) })
        .from(earnings)
        .where(inArray(earnings.postId, rows.map((r) => r.post.id)))
        .groupBy(earnings.postId)
    : [];
  const earnedBy = new Map(earned.map((e) => [e.postId, e.total]));

  return (
    <div className="animate-rise">
      <CampaignPill campaigns={ctx.campaigns} selectedId={ctx.selected?.id ?? null} />
      <PageTitle className="mt-5" action={<ButtonLink href="/app/videos/new" size="sm"><Plus className="size-4" /> Submit</ButtonLink>}>
        Videos
      </PageTitle>
      {rows.length === 0 ? (
        <EmptyState icon={<Clapperboard className="size-6" />} title="No videos yet" action={<ButtonLink href="/app/videos/new">Submit your first video</ButtonLink>}>
          Post on your accounts, then paste the link here so it counts for your goal and starts earning.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {rows.map(({ post, handle, platform, campaignName }) => (
            <div key={post.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[15px] font-medium">
                    {platform ? <PlatformIcon platform={platform} className="size-3.5" /> : null}
                    <span className="truncate">{handle ? `@${handle}` : "Removed account"}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-subtle">
                    {campaignName} · {formatDate(post.createdAt, env.locale, user.timezone)}
                  </p>
                </div>
                <Badge tone={postStatusTone[post.status]}>{post.status}</Badge>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-4 text-muted">
                  <span className="tabular inline-flex items-center gap-1">
                    <Eye className="size-3.5" /> {formatCompact(post.views)}
                  </span>
                  <span className="tabular text-fg">{formatMoney(earnedBy.get(post.id) ?? 0)}</span>
                </div>
                <div className="flex items-center gap-1">
                  {post.status === "pending" ? (
                    <form action={deletePendingVideoAction}>
                      <input type="hidden" name="postId" value={post.id} />
                      <SubmitButton variant="ghost" size="sm" className="h-8 text-muted" confirm="Remove this submission?">
                        Remove
                      </SubmitButton>
                    </form>
                  ) : null}
                  <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-muted hover:bg-surface-2 hover:text-fg">
                    Open <ExternalLink className="size-3.5" />
                  </a>
                </div>
              </div>
              {post.status === "rejected" && post.reviewNote ? <p className="mt-2 rounded-xl bg-danger/8 px-3 py-2 text-xs text-danger">{post.reviewNote}</p> : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
