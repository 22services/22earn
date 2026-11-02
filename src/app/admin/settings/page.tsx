import type { Metadata } from "next";
import { Check, X } from "lucide-react";
import { changePasswordAction, updateSettingsAction } from "@/app/admin/actions";
import { CopyButton } from "@/components/copy-button";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PushToggle } from "@/components/push-toggle";
import { Card, cn, Field, Input, PageTitle, SectionTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { env, providers } from "@/lib/env";
import { centsToDecimalString } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings" };

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", ok ? "bg-success/15 text-success" : "bg-surface-3 text-subtle")}>
        {ok ? <Check className="size-3" /> : <X className="size-3" />}
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-medium">{label}</p>
        <div className="text-muted">{detail}</div>
      </div>
    </div>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-subtle">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 text-xs">{url}</code>
      <CopyButton value={url} label="Copy" />
    </div>
  );
}

export default async function AdminSettings() {
  await requireAdmin();
  const s = await getSettings();
  const stripeKeyMode = env.stripe.secretKey.startsWith("sk_live") || env.stripe.secretKey.startsWith("rk_live") ? "live" : env.stripe.secretKey ? "test" : null;

  return (
    <div className="animate-rise max-w-3xl">
      <PageTitle>Settings</PageTitle>

      <SectionTitle>Payout rules</SectionTitle>
      <Card className="p-5">
        <ActionForm action={updateSettingsAction} className="grid gap-4 sm:grid-cols-3">
          <Field label="Maturing period (hours)" hint="New earnings wait this long before they can be withdrawn.">
            <Input name="holdHours" type="number" min={0} max={1440} defaultValue={s.holdHours} className="mt-1.5" />
          </Field>
          <Field label={`Minimum withdrawal (${env.currency})`} hint="Smallest amount a creator can withdraw.">
            <Input name="minPayout" inputMode="decimal" defaultValue={centsToDecimalString(s.minPayoutCents)} className="mt-1.5" />
          </Field>
          <Field label="Reminder hours (creator's local time)" hint="Push reminders when today's goal isn't met, e.g. 12,18,21">
            <Input name="reminderHours" defaultValue={s.reminderHours} placeholder="12,18,21" className="mt-1.5" />
          </Field>
          <div className="sm:col-span-3">
            <SubmitButton pendingText="Saving…">Save rules</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <SectionTitle>Integrations</SectionTitle>
      <Card className="divide-y divide-line">
        <Status
          ok={providers.stripe()}
          label={`Stripe Connect${stripeKeyMode ? ` (${stripeKeyMode} mode)` : ""}`}
          detail={
            <>
              {env.stripe.secretKey ? "Secret key set." : "Set STRIPE_SECRET_KEY."} {env.stripe.webhookSecret ? "Webhook secret set." : "Set STRIPE_WEBHOOK_SECRET."} Service agreement: {env.stripe.serviceAgreement}.
              <UrlRow label="Webhook URL" url={`${env.appUrl}/api/webhooks/stripe`} />
              <p className="mt-1 text-xs text-subtle">Events: account.updated, transfer.reversed — enable “Listen to events on Connected accounts”.</p>
            </>
          }
        />
        <Status
          ok={providers.paypal()}
          label={`PayPal Payouts (${env.paypal.mode})`}
          detail={
            <>
              {env.paypal.clientId ? "Client id/secret set." : "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."} {env.paypal.webhookId ? "Webhook id set." : "Set PAYPAL_WEBHOOK_ID."}
              <UrlRow label="Webhook URL" url={`${env.appUrl}/api/webhooks/paypal`} />
              <p className="mt-1 text-xs text-subtle">Events: all “Payment payouts-item …” and “Payment payoutsbatch …” events.</p>
            </>
          }
        />
        <Status ok={providers.push()} label="Push notifications" detail={providers.push() ? "VAPID keys set." : "Run `npm run vapid:generate` and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY."} />
        <Status
          ok={Boolean(env.cronSecret)}
          label="Posting reminders (cron)"
          detail={
            <>
              {env.cronSecret ? "CRON_SECRET set." : "Set CRON_SECRET."} Call this URL every 15–60 min with header <code>Authorization: Bearer $CRON_SECRET</code>.
              <UrlRow label="Cron URL" url={`${env.appUrl}/api/cron/reminders`} />
            </>
          }
        />
        {env.simulatePayouts ? <Status ok={false} label="Simulation mode is ON" detail="PAYOUTS_SIMULATE=true — payouts are faked. Turn it off in production." /> : null}
      </Card>

      {providers.push() ? (
        <>
          <SectionTitle>Your notifications</SectionTitle>
          <Card className="p-5">
            <PushToggle publicKey={env.push.publicKey} />
            <p className="mt-2 text-xs text-subtle">Get a push when a creator asks for a withdrawal.</p>
          </Card>
        </>
      ) : null}

      <SectionTitle>Your password</SectionTitle>
      <Card className="p-5">
        <ActionForm action={changePasswordAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
          <Field label="Current password">
            <Input name="current" type="password" required autoComplete="current-password" className="mt-1.5" />
          </Field>
          <Field label="New password">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1.5" />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton variant="subtle" pendingText="Saving…">
              Change password
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
