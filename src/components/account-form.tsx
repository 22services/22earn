import { saveAccountAction } from "@/app/app/actions";
import type { SocialAccount } from "@/db/schema";
import { ActionForm, SubmitButton } from "./forms";
import { Field, Input, Select } from "./ui";

export function AccountForm({ account }: { account?: SocialAccount }) {
  return (
    <ActionForm action={saveAccountAction} className="space-y-4">
      {account ? <input type="hidden" name="id" value={account.id} /> : null}
      <Field label="Platform">
        <Select name="platform" defaultValue={account?.platform ?? "tiktok"} className="mt-1.5">
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </Select>
      </Field>
      <Field label="Handle">
        <Input name="handle" required defaultValue={account ? `@${account.handle}` : ""} placeholder="@alex.clips" autoCapitalize="none" autoCorrect="off" className="mt-1.5" />
      </Field>
      <Field label="Followers">
        <Input name="followers" type="number" inputMode="numeric" min={0} required defaultValue={account?.followers ?? ""} placeholder="48200" className="mt-1.5" />
      </Field>
      <Field label="Profile picture link (optional)" hint="Right-click your profile picture → Copy image address.">
        <Input name="avatarUrl" type="url" defaultValue={account?.avatarUrl ?? ""} placeholder="https://…" className="mt-1.5" />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingText="Saving…">
        {account ? "Save changes" : "Add account"}
      </SubmitButton>
    </ActionForm>
  );
}
