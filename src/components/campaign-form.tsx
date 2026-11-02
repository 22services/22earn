import { saveCampaignAction } from "@/app/admin/actions";
import type { Campaign } from "@/db/schema";
import { centsToDecimalString } from "@/lib/money";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select, Textarea } from "./ui";

const money = (c: number | null | undefined) => (c == null ? "" : centsToDecimalString(c));

export function CampaignForm({ campaign, currency, creators }: { campaign?: Campaign; currency: string; creators?: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveCampaignAction} className="grid gap-4 md:grid-cols-2" resetOnSuccess={!campaign}>
      {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}
      <Field label="Name">
        <Input name="name" required defaultValue={campaign?.name} placeholder="Summer Clips" className="mt-1.5" />
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={campaign?.status ?? "active"} className="mt-1.5">
          <option value="active">Active — accepting videos</option>
          <option value="paused">Paused</option>
          <option value="ended">Ended</option>
        </Select>
      </Field>
      <Field label={`Pay per 1,000 views (${currency})`} hint="Leave empty for no view-based pay.">
        <Input name="cpm" inputMode="decimal" defaultValue={money(campaign?.cpmCents || null)} placeholder="1.50" className="mt-1.5" />
      </Field>
      <Field label={`Pay per approved video (${currency})`} hint="Paid once when you approve the video.">
        <Input name="flatFee" inputMode="decimal" defaultValue={money(campaign?.flatFeeCents || null)} placeholder="5.00" className="mt-1.5" />
      </Field>
      <Field label={`Max per video (${currency}, optional)`} hint="Caps fee + views for a single video.">
        <Input name="maxPerPost" inputMode="decimal" defaultValue={money(campaign?.maxPerPostCents)} placeholder="200.00" className="mt-1.5" />
      </Field>
      <Field label="Brief for creators" className="md:col-span-2">
        <Textarea name="description" defaultValue={campaign?.description} placeholder="What to post, hashtags, do's and don'ts…" className="mt-1.5" />
      </Field>
      {!campaign && creators?.length ? (
        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium text-muted">Add creators</legend>
          <div className="flex flex-wrap gap-2">
            {creators.map((c) => (
              <label key={c.id} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm has-[:checked]:border-accent/60">
                <input type="checkbox" name="userId" value={c.id} className="accent-[var(--color-accent)]" />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="md:col-span-2">
        <SubmitButton pendingText="Saving…">{campaign ? "Save campaign" : "Create campaign"}</SubmitButton>
        {campaign ? <p className="mt-2 text-xs text-subtle">Rates are frozen per video when you approve it — changes apply to videos approved afterwards.</p> : null}
      </div>
    </ActionForm>
  );
}
