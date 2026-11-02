import type { Metadata } from "next";
import { and, eq, gt } from "drizzle-orm";
import Link from "next/link";
import { ActionForm, SubmitButton, TimezoneInput } from "@/components/forms";
import { Card, Field, Input, buttonClass } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { acceptInviteAction } from "../../actions";

export const metadata: Metadata = { title: "Join" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [user] = await db
    .select({ name: users.name, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.inviteTokenHash, sha256(token)), gt(users.inviteExpiresAt, new Date())))
    .limit(1);

  if (!user || user.status === "disabled") {
    return (
      <Card className="p-6 text-center">
        <h1 className="text-xl font-bold">Link expired</h1>
        <p className="mt-2 text-sm text-muted">This link has expired or was already used. Ask the admin to send you a new one.</p>
        <Link href="/login" className={buttonClass("outline", "md", "mt-6 w-full")}>
          Go to sign in
        </Link>
      </Card>
    );
  }

  const isReset = user.status === "active";
  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">{isReset ? "Choose a new password" : "Welcome to the team 👋"}</h1>
      <p className="mt-1 text-sm text-muted">
        {isReset ? "Set a new password for " : "Create your password to start tracking your earnings — "}
        <span className="text-fg">{user.email}</span>
      </p>
      <ActionForm action={acceptInviteAction} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        <TimezoneInput />
        <Field label="Your name">
          <Input name="name" defaultValue={user.name} required autoComplete="name" className="mt-1.5" />
        </Field>
        <Field label={isReset ? "New password" : "Password"} hint="At least 8 characters.">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" className="mt-1.5" />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Saving…">
          {isReset ? "Save password" : "Join and continue"}
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
