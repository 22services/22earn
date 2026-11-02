import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { ActionForm, SubmitButton, TimezoneInput } from "@/components/forms";
import { Card, Field, Input } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { setupAction } from "../actions";

export const metadata: Metadata = { title: "Set up" };
// Must be evaluated per request: it depends on whether the database has users yet.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [row] = await db.select({ value: count() }).from(users);
  if ((row?.value ?? 0) > 0) redirect("/login");

  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">Create the owner account</h1>
      <p className="mt-1 text-sm text-muted">
        This first account is the <span className="text-fg">admin</span>: it manages creators, campaigns and payouts. This page disappears once it exists.
      </p>
      <ActionForm action={setupAction} className="mt-6 space-y-4">
        <TimezoneInput />
        <Field label="Your name">
          <Input name="name" required autoComplete="name" className="mt-1.5" />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" className="mt-1.5" />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1.5" />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Creating…">
          Create admin account
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
