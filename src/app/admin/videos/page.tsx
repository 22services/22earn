import type { Metadata } from "next";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { reviewPostAction, updateViewsAction } from "@/app/admin/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PlatformIcon } from "@/components/platform-icon";
import { postStatusTone } from "@/components/status";
import { Avatar, Badge, Card, cn, Input, PageTitle } from "@/components/ui";
import { db } from "@/db";
import { campaigns, earnings, posts, socialAccounts, users, type PostStatus } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDateTime, timeAgo } from "@/lib/time";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Videos" };

const tabs: { key: PostStatus | "all"; label: string }[] = [
  { key: "pending", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export default async function AdminVideos({ searchParams }: { searchParams: Promise<{ status?: string; campaign?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = (tabs.find((t) => t.key === sp.status)?.key ?? "pending") as PostStatus | "all";
  const campaignId = sp.campaign && uuidSchema.safeParse(sp.campaign).success ? sp.campaign : null;

  const where: SQL[] = [];
  if (status !== "all") where.push(eq(posts.status, status));
  if (campaignId) where.push(eq(posts.campaignId, campaignId));

  const [rows, allCampaigns, counts] = await Promise.all([
    db
      .select({ post: posts, userName: users.name, handle: socialAccounts.handle, platform: socialAccounts.platform, followers: socialAccounts.followers, campaign: campaigns.name })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .innerJoin(campaigns, eq(campaigns.id, posts.campaignId))
      .leftJoin(socialAccounts, eq(socialAccounts.id, posts.socialAccountId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(status === "pending" ? posts.createdAt : desc(posts.createdAt))
      .limit(300),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(campaigns.name),
    db.select({ status: posts.status, n: sql`count(*)`.mapWith(Number) }).from(posts).groupBy(posts.status),
  ]);
  const earned = rows.length
    ? await db
        .select({ postId: earnings.postId, total: sql`sum(${earnings.amountCents})`.mapWith(Number) })
        .from(earnings)
        .where(inArray(earnings.postId, rows.map((r) => r.post.id)))
        .groupBy(earnings.postId)
    : [];
  const earnedBy = new Map(earned.map((e) => [e.postId, e.total]));
  const countBy = new Map(counts.map((c) => [c.status, c.n]));
  const qs = (s: string, c: string | null) => `/admin/videos?status=${s}${c ? `&campaign=${c}` : ""}`;

  return (
    <div className="animate-rise">
      <PageTitle>Videos</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-2xl bg-surface p-1 text-sm font-medium">
          {tabs.map((t) => (
            <Link key={t.key} href={qs(t.key, campaignId)} className={cn("rounded-xl px-3 py-1.5", status === t.key ? "bg-surface-3" : "text-muted hover:text-fg")}>
              {t.label}
              {t.key !== "all" && countBy.get(t.key) ? <span className="ml-1.5 text-xs text-subtle">{countBy.get(t.key)}</span> : null}
            </Link>
          ))}
        </div>
        <div className="no-scrollbar flex gap-1 overflow-x-auto text-sm">
          <Link href={qs(status, null)} className={cn("rounded-full border px-3 py-1", !campaignId ? "border-accent/60 text-fg" : "border-line text-muted")}>
            All campaigns
          </Link>
          {allCampaigns.map((c) => (
            <Link key={c.id} href={qs(status, c.id)} className={cn("whitespace-nowrap rounded-full border px-3 py-1", campaignId === c.id ? "border-accent/60 text-fg" : "border-line text-muted")}>
              {c.name}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-subtle">
        Approving pays the campaign&apos;s per-video fee. Enter the current view count any time — the difference is paid at the campaign&apos;s rate (rates are frozen at approval).
      </p>

      <div className="mt-3 space-y-3">
        {rows.length === 0 ? <Card className="p-8 text-center text-sm text-muted">Nothing here. 🎉</Card> : null}
        {rows.map(({ post, userName, handle, platform, followers, campaign }) => (
          <Card key={post.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={userName} size={36} />
                <div className="min-w-0">
                  <p className="font-medium">
                    <Link href={`/admin/influencers/${post.userId}`} className="hover:underline">
                      {userName}
                    </Link>
                    <span className="ml-2 inline-flex items-center gap-1 text-sm text-muted">
                      {platform ? <PlatformIcon platform={platform} className="size-3.5" /> : null}@{handle ?? "removed"}
                      {followers ? <span className="text-subtle">· {formatNumber(followers)}</span> : null}
                    </span>
                  </p>
                  <p className="text-xs text-subtle">
                    {campaign} · submitted {timeAgo(post.createdAt)} ({formatDateTime(post.createdAt)})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={postStatusTone[post.status]}>{post.status}</Badge>
                <span className="tabular text-sm font-semibold">{formatMoney(earnedBy.get(post.id) ?? 0)}</span>
              </div>
            </div>

            <a href={post.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1.5 truncate rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs text-muted hover:text-fg">
              <ExternalLink className="size-3.5 shrink-0" /> <span className="truncate">{post.url}</span>
            </a>
            {post.reviewNote && post.status === "rejected" ? <p className="mt-2 text-xs text-danger">Reason: {post.reviewNote}</p> : null}

            <div className="mt-3 flex flex-wrap items-start gap-2">
              {post.status === "pending" || post.status === "rejected" ? (
                <ActionForm action={reviewPostAction} className="flex items-center gap-2">
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <Input name="views" type="number" min={0} placeholder="Views (optional)" defaultValue={post.views || ""} className="h-9 w-40 text-sm" aria-label="Views" />
                  <SubmitButton size="sm" pendingText="…">
                    Approve
                  </SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={updateViewsAction} className="flex items-center gap-2">
                  <input type="hidden" name="postId" value={post.id} />
                  <Input name="views" type="number" min={0} required defaultValue={post.views} className="h-9 w-40 text-sm" aria-label="Views" />
                  <SubmitButton size="sm" variant="subtle" pendingText="…">
                    Update views
                  </SubmitButton>
                </ActionForm>
              )}
              {post.status !== "rejected" ? (
                <details className="group">
                  <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-2xl px-3 text-sm text-muted hover:bg-surface-2 hover:text-danger">Reject…</summary>
                  <ActionForm action={reviewPostAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="decision" value="reject" />
                    <Input name="note" maxLength={300} placeholder="Reason (they'll see it)" className="h-9 w-64 text-sm" />
                    <SubmitButton
                      size="sm"
                      variant="danger"
                      pendingText="…"
                      confirm={post.status === "approved" ? "Reject an approved video? Everything it earned will be reversed in the ledger." : undefined}
                    >
                      Reject
                    </SubmitButton>
                  </ActionForm>
                </details>
              ) : null}
              {post.viewsUpdatedAt ? <span className="self-center text-xs text-subtle">views updated {timeAgo(post.viewsUpdatedAt)}</span> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
