import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { submitVideoAction } from "@/app/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { platformMeta } from "@/components/platform-icon";
import { ButtonLink, Card, EmptyState, Field, Input, Notice, Select } from "@/components/ui";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { requireInfluencer } from "@/lib/auth";
import { getCampaignContext } from "@/lib/campaign-context";

export const metadata: Metadata = { title: "Submit a video" };

export default async function NewVideoPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const user = await requireInfluencer();
  const { account } = await searchParams;
  const [accounts, ctx] = await Promise.all([
    db.select().from(socialAccounts).where(eq(socialAccounts.userId, user.id)).orderBy(desc(socialAccounts.followers)),
    getCampaignContext(user.id),
  ]);
  const active = ctx.campaigns.filter((c) => c.status === "active");
  const defaultCampaign = active.find((c) => c.id === ctx.selected?.id)?.id ?? active[0]?.id;

  return (
    <div className="animate-rise">
      <Link href="/app/videos" className="-ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> Videos
      </Link>
      <h1 className="mt-3 text-[28px] font-bold tracking-tight">Submit a video</h1>
      <p className="mt-1 text-sm text-muted">Posted something? Paste the link — it counts for today&apos;s goal right away and earns once approved.</p>

      {accounts.length === 0 ? (
        <div className="mt-5">
          <EmptyState title="Add an account first" action={<ButtonLink href="/app/accounts/new">Add an account</ButtonLink>}>
            Videos are linked to one of your social accounts.
          </EmptyState>
        </div>
      ) : active.length === 0 ? (
        <Notice tone="warning" className="mt-5">
          No campaign is accepting videos right now.
        </Notice>
      ) : (
        <Card className="mt-5 p-5">
          <ActionForm action={submitVideoAction} className="space-y-4" resetOnSuccess>
            <Field label="Video link">
              <Input name="url" type="url" inputMode="url" required placeholder="https://www.tiktok.com/@you/video/…" className="mt-1.5" autoFocus />
            </Field>
            <Field label="Posted on">
              <Select name="socialAccountId" defaultValue={accounts.find((a) => a.id === account)?.id ?? accounts[0]!.id} className="mt-1.5">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.handle} · {platformMeta[a.platform].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Campaign">
              <Select name="campaignId" defaultValue={defaultCampaign} className="mt-1.5">
                {active.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton size="lg" className="w-full" pendingText="Submitting…">
              Submit video
            </SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
