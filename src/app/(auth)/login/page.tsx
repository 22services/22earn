import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user));
  const [row] = await db.select({ value: count() }).from(users);
  if ((row?.value ?? 0) === 0) redirect("/setup");
  const { next } = await searchParams;

  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to see your earnings and today&apos;s goals.</p>
      <ActionForm action={loginAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required autoFocus placeholder="you@example.com" className="mt-1.5" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required className="mt-1.5" />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-xs text-subtle">New creator? Use the invite link the admin sent you.</p>
    </Card>
  );
}
