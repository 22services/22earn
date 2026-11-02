import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteAccountAction } from "@/app/app/actions";
import { AccountForm } from "@/components/account-form";
import { SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui";
import { db } from "@/db";
import { socialAccounts } from "@/db/schema";
import { requireInfluencer } from "@/lib/auth";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Edit account" };

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireInfluencer();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const [account] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.id, id), eq(socialAccounts.userId, user.id)))
    .limit(1);
  if (!account) notFound();

  return (
    <div className="animate-rise">
      <Link href="/app/accounts" className="-ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> My accounts
      </Link>
      <h1 className="mt-3 text-[28px] font-bold tracking-tight">@{account.handle}</h1>
      <p className="mb-5 mt-1 text-sm text-muted">
        🎯 Goal: {account.goalPerDay} video{account.goalPerDay > 1 ? "s" : ""}/day (set by your manager)
      </p>
      <Card className="p-5">
        <AccountForm account={account} />
      </Card>
      <form action={deleteAccountAction} className="mt-4">
        <input type="hidden" name="id" value={account.id} />
        <SubmitButton variant="danger" className="w-full" confirm={`Remove @${account.handle}? Its videos stay in your history.`}>
          Remove account
        </SubmitButton>
      </form>
    </div>
  );
}
