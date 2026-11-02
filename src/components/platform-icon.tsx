import type { Platform, PayoutMethod } from "@/db/schema";
import { brandPaths } from "./brand-paths";
import { cn } from "./ui";

export const platformMeta: Record<Platform, { label: string; color: string; profileUrl: (handle: string) => string; host: RegExp }> = {
  tiktok: { label: "TikTok", color: "#ffffff", profileUrl: (h) => `https://www.tiktok.com/@${h}`, host: /(^|\.)tiktok\.com$/ },
  instagram: { label: "Instagram", color: "#ff3d8b", profileUrl: (h) => `https://www.instagram.com/${h}`, host: /(^|\.)instagram\.com$/ },
  youtube: { label: "YouTube", color: "#ff3b30", profileUrl: (h) => `https://www.youtube.com/@${h}`, host: /(^|\.)(youtube\.com|youtu\.be)$/ },
};

export function PlatformIcon({ platform, className, colored = false }: { platform: Platform; className?: string; colored?: boolean }) {
  const p = brandPaths[platform];
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={platformMeta[platform].label} className={cn("size-4 shrink-0", className)} fill={colored ? platformMeta[platform].color : "currentColor"}>
      <path d={p.path} />
    </svg>
  );
}

export function PayoutIcon({ method, className }: { method: PayoutMethod; className?: string }) {
  const p = brandPaths[method];
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={method === "stripe" ? "Stripe" : "PayPal"} className={cn("size-4 shrink-0", className)} fill={method === "stripe" ? "#8b85ff" : "#4ea1ff"}>
      <path d={p.path} />
    </svg>
  );
}
