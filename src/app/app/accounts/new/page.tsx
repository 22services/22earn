import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { AccountForm } from "@/components/account-form";
import { Card } from "@/components/ui";
import { requireInfluencer } from "@/lib/auth";

export const metadata: Metadata = { title: "Add account" };

export default async function NewAccountPage() {
  await requireInfluencer();
  return (
    <div className="animate-rise">
      <Link href="/app/accounts" className="-ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" /> My accounts
      </Link>
      <h1 className="mt-3 mb-5 text-[28px] font-bold tracking-tight">Add an account</h1>
      <Card className="p-5">
        <AccountForm />
      </Card>
    </div>
  );
}
