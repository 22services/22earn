import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setCampaignMembersAction } from "@/app/admin/actions";
import { CampaignForm } from "@/components/campaign-form";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, SectionTitle } from "@/components/ui";
import { db } from "@/db";
import { campaignMembers, campaigns, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) notFound();
  const [members, creators] = await Promise.all([
    db.select({ userId: campaignMembers.userId }).from(campaignMembers).where(eq(campaignMembers.campaignId, id)),
    db.select({ id: users.id, name: users.name, status: users.status }).from(users).where(eq(users.role, "influencer")).orderBy(users.name),
  ]);
  const memberSet = new Set(members.map((m) => m.userId));

  return (
    <div className="animate-rise">
      <Link href="/admin/campaigns" className="-ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> Campaigns
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">{campaign.name}</h1>
      <Card className="mt-5 p-5">
        <CampaignForm campaign={campaign} currency={env.currency} />
      </Card>

      <SectionTitle>Creators in this campaign</SectionTitle>
      <Card className="p-5">
        {creators.length === 0 ? (
          <p className="text-sm text-muted">
            No creators yet. <Link href="/admin/influencers" className="text-fg underline">Invite one</Link>.
          </p>
        ) : (
          <ActionForm action={setCampaignMembersAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div className="flex flex-wrap gap-2">
              {creators.map((c) => (
                <label key={c.id} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm has-[:checked]:border-accent/60">
                  <input type="checkbox" name="userId" value={c.id} defaultChecked={memberSet.has(c.id)} className="accent-[var(--color-accent)]" />
                  {c.name}
                  {c.status !== "active" ? <span className="text-xs text-subtle">({c.status})</span> : null}
                </label>
              ))}
            </div>
            <SubmitButton size="sm" variant="subtle" className="mt-4" pendingText="Saving…">
              Save members
            </SubmitButton>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
