import type { Metadata } from "next";
import { ArrowUpRight, Check, CircleSlash, Clock3, Gift, Info, Play, Scale, X } from "lucide-react";
import Link from "next/link";
import { cancelWithdrawAction, openStripeDashboardAction, requestWithdrawAction } from "@/app/app/actions";
import { CampaignPill } from "@/components/campaign-pill";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PayoutIcon } from "@/components/platform-icon";
import { ButtonLink, Card, cn, Pill, SectionTitle } from "@/components/ui";
import type { EarningKind, PayoutMethod, PayoutStatus } from "@/db/schema";
import { requireInfluencer } from "@/lib/auth";
import { getCampaignContext } from "@/lib/campaign-context";
import { env } from "@/lib/env";
import { getBalance, listEarnings, listTransfers } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/payouts";
import { getSettings } from "@/lib/settings";
import { formatDate, formatMonth, timeUntil } from "@/lib/time";

export const metadata: Metadata = { title: "Earnings" };

export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requireInfluencer();
  const { view } = await searchParams;
  const { campaigns, selected } = await getCampaignContext(user.id);
  const campaignId = selected?.id ?? null;
  const [balance, overall, transfers, settings, activity] = await Promise.all([
    getBalance(user.id, { campaignId }),
    getBalance(user.id),
    listTransfers(user.id, { campaignId }),
    getSettings(),
    view === "activity" ? listEarnings(user.id, { campaignId, limit: 100 }) : Promise.resolve([]),
  ]);

  const usedMethods = new Set(transfers.filter((t) => t.status === "paid").map((t) => t.method));
  const sentLabel =
    usedMethods.size > 1 ? "Stripe & PayPal" : usedMethods.size === 1 ? methodLabel([...usedMethods][0]!) : user.payoutMethod ? methodLabel(user.payoutMethod) : null;
  const providerPill: PayoutMethod | null = user.payoutMethod ?? (usedMethods.size === 1 ? [...usedMethods][0]! : null);
  const openRequest = transfers.find((t) => t.status === "requested");
  const canWithdraw = overall.availableCents >= settings.minPayoutCents && overall.availableCents > 0;
  const destination = user.payoutMethod === "paypal" ? user.paypalEmail : user.payoutMethod === "stripe" ? "your Stripe account" : null;

  return (
    <div className="animate-rise">
      <CampaignPill campaigns={campaigns} selectedId={campaignId} />
      <h1 className="mt-5 text-[28px] font-bold tracking-tight">Earnings</h1>

      {/* ---------------------------------------------------- balance card */}
      <Card className="mt-4">
        <div className="px-5 pb-4 pt-5">
          <p className="text-[15px] text-muted">Pending</p>
          <p className="tabular mt-1.5 text-[44px] font-bold leading-none tracking-tight">{formatMoney(balance.pendingCents)}</p>
          {balance.maturingCents > 0 ? (
            <p className="mt-3 text-sm text-muted">
              including <span className="tabular text-fg">{formatMoney(balance.maturingCents)}</span> maturing ({settings.holdHours} h)
            </p>
          ) : null}
          <details className="group mt-3">
            <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted hover:text-fg">
              <Info className="size-4" /> How does it work?
            </summary>
            <div className="mt-3 space-y-2.5 rounded-2xl bg-surface-2 p-4 text-sm leading-relaxed text-muted">
              <p>
                <span className="font-medium text-fg">1. Post & submit.</span> Every approved video earns{" "}
                {selected ? (
                  <>
                    {selected.flatFeeCents > 0 ? <span className="text-fg">{formatMoney(selected.flatFeeCents)} per video</span> : null}
                    {selected.flatFeeCents > 0 && selected.cpmCents > 0 ? " + " : null}
                    {selected.cpmCents > 0 ? <span className="text-fg">{formatMoney(selected.cpmCents)} per 1,000 views</span> : null}
                    {selected.maxPerPostCents ? ` (max ${formatMoney(selected.maxPerPostCents)} per video)` : null}
                    {selected.flatFeeCents === 0 && selected.cpmCents === 0 ? "the rate set for this campaign" : null}
                  </>
                ) : (
                  "the rate of its campaign (per video and/or per 1,000 views)"
                )}
                . Bonuses can be added on top.
              </p>
              <p>
                <span className="font-medium text-fg">2. Maturing.</span> New earnings are checked for {settings.holdHours} hours, then become available.
              </p>
              <p>
                <span className="font-medium text-fg">3. Withdraw.</span> From {formatMoney(settings.minPayoutCents)}, tap Withdraw. Once approved, the money is sent to your Stripe or PayPal and shows up in your transfer history.
              </p>
            </div>
          </details>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4">
          <div>
            <p className="text-[13px] text-muted">{sentLabel ? `Sent to ${sentLabel}` : "Sent to you"}</p>
            <p className="tabular mt-0.5 text-lg font-semibold">{formatMoney(balance.paidCents)}</p>
          </div>
          {providerPill === "stripe" && user.stripeAccountId ? (
            <form action={openStripeDashboardAction}>
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-3.5 py-1.5 text-[13px] font-semibold hover:bg-line">
                <PayoutIcon method="stripe" className="size-3.5" /> Stripe <ArrowUpRight className="size-3.5 text-muted" />
              </button>
            </form>
          ) : providerPill === "paypal" ? (
            <a href="https://www.paypal.com/myaccount/summary" target="_blank" rel="noreferrer">
              <Pill className="px-3.5 py-1.5 font-semibold hover:bg-line">
                <PayoutIcon method="paypal" className="size-3.5" /> PayPal <ArrowUpRight className="size-3.5 text-muted" />
              </Pill>
            </a>
          ) : null}
        </div>
      </Card>

      {/* ------------------------------------------------------- withdraw */}
      <div className="mt-3">
        {openRequest ? (
          <Card className="flex items-center justify-between gap-3 px-5 py-4">
            <div className="text-sm">
              <p className="font-medium">
                <span className="tabular">{formatMoney(openRequest.amountCents)}</span> withdrawal requested
              </p>
              <p className="text-muted">Waiting for approval · {methodLabel(openRequest.method)}</p>
            </div>
            <form action={cancelWithdrawAction}>
              <input type="hidden" name="payoutId" value={openRequest.id} />
              <SubmitButton variant="ghost" size="sm" confirm="Cancel this withdrawal request?">
                Cancel
              </SubmitButton>
            </form>
          </Card>
        ) : !user.payoutMethod ? (
          <ButtonLink href="/app/settings#payouts" variant="outline" size="lg" className="w-full">
            Set up Stripe or PayPal to withdraw
          </ButtonLink>
        ) : (
          <ActionForm action={requestWithdrawAction}>
            <SubmitButton
              variant="outline"
              size="lg"
              className={cn("w-full", canWithdraw && "border-accent/50")}
              pendingText="Requesting…"
              confirm={`Withdraw ${formatMoney(overall.availableCents)} to ${destination ?? methodLabel(user.payoutMethod)}?`}
            >
              <ArrowUpRight className="size-[18px]" />
              {canWithdraw ? `Withdraw ${formatMoney(overall.availableCents)} to ${methodLabel(user.payoutMethod)}` : `Withdraw to ${methodLabel(user.payoutMethod)}`}
            </SubmitButton>
          </ActionForm>
        )}
        <p className="tabular mt-2.5 px-1 text-center text-xs text-subtle">
          Available now {formatMoney(Math.max(0, overall.availableCents))}
          {overall.nextMaturityAt ? ` · next unlock ${timeUntil(overall.nextMaturityAt)}` : ""}
          {overall.inTransitCents > 0 ? ` · ${formatMoney(overall.inTransitCents)} on its way` : ""}
          {!canWithdraw && !openRequest ? ` · minimum ${formatMoney(settings.minPayoutCents)}` : ""}
        </p>
        {selected ? <p className="mt-1 text-center text-xs text-subtle">Withdrawals include all campaigns.</p> : null}
      </div>

      {/* --------------------------------------------------------- tabs */}
      <div className="mt-7 flex gap-1 rounded-2xl bg-surface p-1 text-sm font-medium" role="tablist">
        <Link href="/app/earnings" role="tab" aria-selected={view !== "activity"} className={cn("flex-1 rounded-xl py-2 text-center", view !== "activity" ? "bg-surface-3" : "text-muted")}>
          Transfer history
        </Link>
        <Link href="/app/earnings?view=activity" role="tab" aria-selected={view === "activity"} className={cn("flex-1 rounded-xl py-2 text-center", view === "activity" ? "bg-surface-3" : "text-muted")}>
          Earnings activity
        </Link>
      </div>

      {view === "activity" ? <Activity rows={activity} timezone={user.timezone} /> : <Transfers rows={transfers} timezone={user.timezone} />}
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function statusLine(status: PayoutStatus, method: PayoutMethod) {
  switch (status) {
    case "paid":
      return <span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" /> Sent to {methodLabel(method)}</span>;
    case "processing":
      return <span className="inline-flex items-center gap-1 text-warning"><Clock3 className="size-3.5" /> Processing · {methodLabel(method)}</span>;
    case "requested":
      return <span className="inline-flex items-center gap-1 text-muted"><Clock3 className="size-3.5" /> Waiting for approval</span>;
    case "failed":
      return <span className="inline-flex items-center gap-1 text-danger"><X className="size-3.5" /> Failed — back in your balance</span>;
    case "canceled":
      return <span className="inline-flex items-center gap-1 text-subtle"><CircleSlash className="size-3.5" /> Canceled</span>;
  }
}

type TransferRow = Awaited<ReturnType<typeof listTransfers>>[number];

function Transfers({ rows, timezone }: { rows: TransferRow[]; timezone: string }) {
  if (rows.length === 0)
    return <p className="mt-6 px-2 text-center text-sm text-muted">No transfers yet. Your first payout will show up here.</p>;
  const groups = new Map<string, TransferRow[]>();
  for (const r of rows) {
    const key = formatMonth(r.paidAt ?? r.requestedAt, env.locale, timezone);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return (
    <div>
      {[...groups].map(([month, items]) => (
        <section key={month}>
          <SectionTitle className="mt-5 text-sm font-normal text-muted">{month}</SectionTitle>
          <Card className="divide-y divide-line">
            {items.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-[15px]">{formatDate(t.paidAt ?? t.requestedAt, env.locale, timezone)}</p>
                  <p className="mt-0.5 text-xs">{statusLine(t.status, t.method)}</p>
                  {t.status === "processing" && t.failureReason ? <p className="mt-1 text-xs text-subtle">{t.failureReason}</p> : null}
                </div>
                <p className={cn("tabular shrink-0 text-[15px] font-semibold", (t.status === "failed" || t.status === "canceled") && "text-subtle line-through")}>
                  {formatMoney(t.displayCents, { currency: t.currency })}
                </p>
              </div>
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}

type ActivityRow = Awaited<ReturnType<typeof listEarnings>>[number];

const kindIcon: Record<EarningKind, typeof Play> = { views: Play, flat_fee: Play, bonus: Gift, adjustment: Scale };

function Activity({ rows, timezone }: { rows: ActivityRow[]; timezone: string }) {
  if (rows.length === 0) return <p className="mt-6 px-2 text-center text-sm text-muted">No earnings yet — submit your first video to start earning.</p>;
  const now = new Date();
  return (
    <Card className="mt-4 divide-y divide-line">
      {rows.map((e) => {
        const Icon = kindIcon[e.kind];
        const state = e.payoutStatus === "paid" ? "Paid" : e.payoutStatus ? "In transfer" : e.maturesAt > now ? `Maturing · ${timeUntil(e.maturesAt, now)}` : "Available";
        return (
          <div key={e.id} className="flex items-center gap-3 px-4 py-3.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-muted">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{e.note ?? e.kind}</p>
              <p className="truncate text-xs text-subtle">
                {formatDate(e.createdAt, env.locale, timezone)}
                {e.campaignName ? ` · ${e.campaignName}` : ""} · {state}
              </p>
            </div>
            <p className={cn("tabular shrink-0 text-sm font-semibold", e.amountCents < 0 ? "text-danger" : "text-fg")}>{formatMoney(e.amountCents, { sign: true })}</p>
          </div>
        );
      })}
    </Card>
  );
}
