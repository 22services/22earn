import type { PayoutStatus, PostStatus } from "@/db/schema";
import type { BadgeTone } from "./ui";

export const postStatusTone: Record<PostStatus, BadgeTone> = { pending: "warning", approved: "success", rejected: "danger" };

export const payoutStatusTone: Record<PayoutStatus, BadgeTone> = {
  requested: "info",
  processing: "warning",
  paid: "success",
  failed: "danger",
  canceled: "neutral",
};
