import type { Metadata } from "next";
import { ArrowUpRight, Check, LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import {
  openStripeDashboardAction,
  savePayPalAction,
  setPayoutMethodAction,
  startStripeOnboardingAction,
  updateProfileAction,
} from "@/app/app/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PayoutIcon } from "@/components/platform-icon";
import { PushToggle } from "@/components/push-toggle";
import { Badge, Card, Field, Input, Notice, SectionTitle, Select } from "@/components/ui";
import { requireInfluencer } from "@/lib/auth";
import { STRIPE_COUNTRIES } from "@/lib/countries";
import { env, providers } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

const allTimezones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((t) => t !== "UTC")];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const user = await requireInfluencer();
  const { stripe } = await searchParams;
  const stripeOn = providers.stripe();
  const paypalOn = providers.paypal();
  const timezones = allTimezones.includes(user.timezone) ? allTimezones : [user.timezone, ...allTimezones];

  return (
    <div className="animate-rise">
      <h1 className="text-[28px] font-bold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">{user.email}</p>

      {stripe === "ready" ? <Notice tone="success" className="mt-4">Stripe is connected — you can now be paid there.</Notice> : null}
      {stripe === "pending" ? <Notice tone="warning" className="mt-4">Stripe still needs a few details before you can receive money. Tap “Finish Stripe setup”.</Notice> : null}
      {stripe === "error" ? <Notice tone="danger" className="mt-4">We couldn&apos;t reach Stripe. Please try again.</Notice> : null}

      {/* ------------------------------------------------------- payouts */}
      <SectionTitle className="scroll-mt-6">
        <span id="payouts">How you get paid</span>
      </SectionTitle>
      {!stripeOn && !paypalOn ? <Notice tone="warning">Payouts aren&apos;t configured on this platform yet.</Notice> : null}

      <div className="space-y-3">
        {stripeOn ? (
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <PayoutIcon method="stripe" className="size-5" />
                <p className="font-semibold">Stripe</p>
                {user.payoutMethod === "stripe" ? <Badge tone="accent">Default</Badge> : null}
              </div>
              {user.stripeReady ? (
                <Badge tone="success">
                  <Check className="size-3" /> Connected
                </Badge>
              ) : user.stripeAccountId ? (
                <Badge tone="warning">Setup incomplete</Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted">Money lands in your Stripe balance and is paid to your bank automatically.</p>

            {!user.stripeAccountId ? (
              <ActionForm action={startStripeOnboardingAction} className="mt-4 space-y-3">
                <Field label="Country of your bank account">
                  <Select name="country" defaultValue={env.stripe.defaultCountry} className="mt-1.5">
                    {STRIPE_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton className="w-full" pendingText="Opening Stripe…">
                  Connect with Stripe <ArrowUpRight className="size-4" />
                </SubmitButton>
              </ActionForm>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {!user.stripeReady ? (
                  <ActionForm action={startStripeOnboardingAction}>
                    <SubmitButton size="sm" pendingText="Opening Stripe…">
                      Finish Stripe setup <ArrowUpRight className="size-4" />
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <form action={openStripeDashboardAction}>
                    <SubmitButton size="sm" variant="subtle">
                      Open Stripe dashboard <ArrowUpRight className="size-4" />
                    </SubmitButton>
                  </form>
                )}
                {user.stripeReady && user.payoutMethod !== "stripe" ? (
                  <form action={setPayoutMethodAction}>
                    <input type="hidden" name="method" value="stripe" />
                    <SubmitButton size="sm" variant="outline">
                      Use Stripe
                    </SubmitButton>
                  </form>
                ) : null}
              </div>
            )}
          </Card>
        ) : null}

        {paypalOn ? (
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <PayoutIcon method="paypal" className="size-5" />
                <p className="font-semibold">PayPal</p>
                {user.payoutMethod === "paypal" ? <Badge tone="accent">Default</Badge> : null}
              </div>
              {user.paypalEmail ? (
                <Badge tone="success">
                  <Check className="size-3" /> Added
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted">Money is sent to the PayPal account using this email.</p>
            <ActionForm action={savePayPalAction} className="mt-4 flex gap-2">
              <Input name="paypalEmail" type="email" required defaultValue={user.paypalEmail ?? ""} placeholder="you@paypal.com" aria-label="PayPal email" />
              <SubmitButton variant="subtle" pendingText="…">
                Save
              </SubmitButton>
            </ActionForm>
            {user.paypalEmail && user.payoutMethod !== "paypal" ? (
              <form action={setPayoutMethodAction} className="mt-2">
                <input type="hidden" name="method" value="paypal" />
                <SubmitButton size="sm" variant="outline">
                  Use PayPal
                </SubmitButton>
              </form>
            ) : null}
          </Card>
        ) : null}
      </div>

      {/* -------------------------------------------------- notifications */}
      {providers.push() ? (
        <>
          <SectionTitle>Notifications</SectionTitle>
          <Card className="p-5">
            <PushToggle publicKey={env.push.publicKey} />
          </Card>
        </>
      ) : null}

      {/* -------------------------------------------------------- profile */}
      <SectionTitle>Profile</SectionTitle>
      <Card className="p-5">
        <ActionForm action={updateProfileAction} className="space-y-4">
          <Field label="Name">
            <Input name="name" defaultValue={user.name} required className="mt-1.5" />
          </Field>
          <Field label="Timezone" hint="Your daily goals and reminders follow this timezone.">
            <Select name="timezone" defaultValue={user.timezone} className="mt-1.5">
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton variant="subtle" pendingText="Saving…">
            Save profile
          </SubmitButton>
        </ActionForm>
      </Card>

      <form action={logoutAction} className="mt-6">
        <SubmitButton variant="ghost" className="w-full text-muted">
          <LogOut className="size-4" /> Sign out
        </SubmitButton>
      </form>
    </div>
  );
}
