import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { campaignMembers, campaigns } from "@/db/schema";

export const CAMPAIGN_COOKIE = "earn_campaign";

/** Campaigns the influencer belongs to + the one selected in the top pill (null = all). */
export async function getCampaignContext(userId: string) {
  const mine = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, description: campaigns.description, cpmCents: campaigns.cpmCents, flatFeeCents: campaigns.flatFeeCents, maxPerPostCents: campaigns.maxPerPostCents })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
    .where(eq(campaignMembers.userId, userId))
    .orderBy(campaigns.createdAt);
  const wanted = (await cookies()).get(CAMPAIGN_COOKIE)?.value;
  const selected = mine.find((c) => c.id === wanted) ?? null;
  return { campaigns: mine, selected };
}

export async function isMember(userId: string, campaignIds: string[]) {
  if (campaignIds.length === 0) return true;
  const rows = await db
    .select({ id: campaignMembers.campaignId })
    .from(campaignMembers)
    .where(and(eq(campaignMembers.userId, userId), inArray(campaignMembers.campaignId, campaignIds)));
  return rows.length === new Set(campaignIds).size;
}
