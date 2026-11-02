import type { Metadata } from "next";
import { Send } from "lucide-react";
import Link from "next/link";
import { approvePayoutAction, payAllAction, rejectPayoutAction, retryPayoutAction, syncPayoutAction } from "@/app/admin/actions";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PayoutIcon } from "@/components/platform-icon";
import { payoutStatusTone } from "@/components/status";
import { Badge, Card, Input, Notice, PageTitle, SectionTitle, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { providers } from "@/lib/env";
import { getBalancesByUser } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { listPayoutsForAdmin, methodLabel, payoutTotals } from "@/lib/payouts";
import { getSettings } from "@/lib/settings";
import { formatDateTime, timeAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Payouts" };

type Row = Awaited<ReturnType<typeof listPayoutsForAdmin>>[number];

function Who({ row }: { row: Row }) {
  return (
    <div className="min-w-0">
      <Link href={`/admin/influencers/${row.payout.userId}`} className="font-medium hover:underline">
        {row.userName}
      </Link>
      <p className="flex items-center gap-1.5 truncate text-xs text-muted">
        <PayoutIcon method={row.payout.method} className="size-3.5" /> {methodLabel(row.payout.method)} → <span className="truncate font-mono">{row.payout.destination}</span>
      </p>
    </div>
  );
}

export default async function AdminPayouts() {
  await requireAdmin();
  const [open, history, totals, balances, settings] = await Promise.all([
    listPayoutsForAdmin("open"),
    listPayoutsForAdmin(),
    payoutTotals(),
    getBalancesByUser(),
    getSettings(),
  ]);
  const requested = open.filter((r) => r.payout.status === "requested");
  const processing = open.filter((r) => r.payout.status === "processing");
  const done = history.filter((r) => !["requested", "processing"].includes(r.payout.status));
  let payable = 0;
  let eligible = 0;
  for (const b of balances.values()) {
    if (b.availableCents > 0) payable += b.availableCents;
    if (b.availableCents >= settings.minPayoutCents) eligible++;
  }

  return (
    <div className="animate-rise">
      <PageTitle>Payouts</PageTitle>
      {!providers.stripe() && !providers.paypal() ? (
        <Notice tone="warning" className="mb-4">
          Neither Stripe nor PayPal is configured — see <Link href="/admin/settings" className="underline">Settings</Link>.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Payable now" value={formatMoney(payable)} hint={`${eligible} creator${eligible === 1 ? "" : "s"} ≥ ${formatMoney(settings.minPayoutCents)}`} tone={payable > 0 ? "accent" : undefined} />
        <Stat label="Requests waiting" value={formatMoney(totals.requested?.totalCents ?? 0)} hint={`${totals.requested?.count ?? 0} request(s)`} />
        <Stat label="Processing" value={formatMoney(totals.processing?.totalCents ?? 0)} hint={`${totals.processing?.count ?? 0} payout(s)`} />
        <Stat label="Paid all time" value={formatMoney(totals.paid?.totalCents ?? 0)} hint={`${totals.paid?.count ?? 0} transfer(s)`} />
      </div>

      <Card className="mt-3 p-5">
        <ActionForm action={payAllAction} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Pay everyone</p>
            <p className="text-sm text-muted">Approves every waiting request, then sends each creator&apos;s payable balance to their Stripe or PayPal.</p>
          </div>
          <SubmitButton pendingText="Paying…" confirm={`Send up to ${formatMoney(payable)} now? Real money will move.`}>
            <Send className="size-4" /> Pay all available
          </SubmitButton>
        </ActionForm>
      </Card>

      {/* ----------------------------------------------------- requests */}
      <SectionTitle>Withdrawal requests</SectionTitle>
      {requested.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No request waiting.</Card>
      ) : (
        <Card className="divide-y divide-line">
          {requested.map((row) => (
            <div key={row.payout.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
              <div className="min-w-0 flex-1">
                <Who row={row} />
                <p className="mt-0.5 text-xs text-subtle">requested {timeAgo(row.payout.requestedAt)}</p>
              </div>
              <p className="tabular text-lg font-bold">{formatMoney(row.payout.amountCents, { currency: row.payout.currency })}</p>
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={approvePayoutAction}>
                  <input type="hidden" name="payoutId" value={row.payout.id} />
                  <SubmitButton size="sm" pendingText="Sending…" confirm={`Send ${formatMoney(row.payout.amountCents)} to ${row.userName} via ${methodLabel(row.payout.method)}?`}>
                    Approve & send
                  </SubmitButton>
                </ActionForm>
                <details>
                  <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-2xl px-3 text-sm text-muted hover:bg-surface-2 hover:text-danger">Reject…</summary>
                  <ActionForm action={rejectPayoutAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="payoutId" value={row.payout.id} />
                    <Input name="reason" placeholder="Reason (optional)" className="h-9 w-56 text-sm" />
                    <SubmitButton size="sm" variant="danger">
                      Reject
                    </SubmitButton>
                  </ActionForm>
                </details>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* --------------------------------------------------- processing */}
      {processing.length ? (
        <>
          <SectionTitle>Processing</SectionTitle>
          <Card className="divide-y divide-line">
            {processing.map((row) => (
              <div key={row.payout.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <Who row={row} />
                  {row.payout.failureReason ? <p className="mt-1 text-xs text-warning">{row.payout.failureReason}</p> : null}
                  {row.payout.providerBatchId ? <p className="mt-0.5 font-mono text-xs text-subtle">batch {row.payout.providerBatchId}</p> : null}
                </div>
                <p className="tabular text-lg font-bold">{formatMoney(row.payout.amountCents, { currency: row.payout.currency })}</p>
                <div className="flex gap-2">
                  <ActionForm action={syncPayoutAction}>
                    <input type="hidden" name="payoutId" value={row.payout.id} />
                    <SubmitButton size="sm" variant="subtle" pendingText="…">
                      Refresh status
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={retryPayoutAction}>
                    <input type="hidden" name="payoutId" value={row.payout.id} />
                    <SubmitButton size="sm" variant="outline" pendingText="…">
                      Retry
                    </SubmitButton>
                  </ActionForm>
                </div>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {/* ------------------------------------------------------ history */}
      <SectionTitle>History</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-subtle">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">Creator</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {done.map((row) => (
              <tr key={row.payout.id}>
                <td className="px-4 py-3">
                  <Who row={row} />
                </td>
                <td className="px-4 py-3">
                  <Badge tone={payoutStatusTone[row.payout.status]}>{row.payout.status}</Badge>
                  {row.payout.failureReason && row.payout.status !== "paid" ? <p className="mt-1 max-w-56 text-xs text-subtle">{row.payout.failureReason}</p> : null}
                </td>
                <td className="px-4 py-3 text-muted">{formatDateTime(row.payout.paidAt ?? row.payout.updatedAt)}</td>
                <td className="px-4 py-3 font-mono text-xs text-subtle">{row.payout.providerRef ?? row.payout.providerBatchId ?? "—"}</td>
                <td className="tabular px-4 py-3 text-right font-semibold">{formatMoney(row.payout.amountCents, { currency: row.payout.currency })}</td>
              </tr>
            ))}
            {done.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">
                  No payouts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
