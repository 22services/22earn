import { z } from "zod";
import { AppError } from "./errors";

export { z };

/** Validate a FormData against a zod schema; the first problem becomes a friendly error. */
export function parseForm<T extends z.ZodType>(schema: T, formData: FormData): z.infer<T> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    raw[key] = typeof value === "string" ? value : value.name;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(issue?.message ?? "Please check the form.");
  }
  return result.data;
}

export const emailSchema = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }));

export const passwordSchema = z
  .string({ error: "Password is required." })
  .min(8, { error: "Use at least 8 characters for the password." })
  .max(200, { error: "That password is too long." });

export const nameSchema = z.string({ error: "Name is required." }).trim().min(1, { error: "Name is required." }).max(80);

export const uuidSchema = z.uuid({ error: "Invalid id." });

/** "@Alex.Clips " → "alex.clips" */
export function normalizeHandle(input: string) {
  return input.trim().replace(/^@+/, "").replace(/^https?:\/\/\S+?\/@?/, "").replace(/\/.*$/, "").toLowerCase();
}

/** Canonical video URL (no tracking params, no trailing slash) so duplicates are caught. */
export function normalizeVideoUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError("Paste the full link to the video (starting with https://).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AppError("Paste a web link to the video.");
  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const keep = new URLSearchParams();
  // YouTube watch links keep their video id
  if (url.searchParams.get("v")) keep.set("v", url.searchParams.get("v")!);
  url.search = keep.toString();
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
