import { Check, ChevronDown } from "lucide-react";
import { selectCampaignAction } from "@/app/app/actions";
import { cn } from "./ui";

/** The "Summer Clips" pill from the reference: a global campaign switcher. */
export function CampaignPill({ campaigns, selectedId }: { campaigns: { id: string; name: string }[]; selectedId: string | null }) {
  const current = campaigns.find((c) => c.id === selectedId);
  const options = [{ id: "all", name: "All campaigns" }, ...campaigns];
  return (
    <details className="group relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium transition hover:bg-surface-3">
        {current?.name ?? "All campaigns"}
        <ChevronDown className="size-3.5 text-muted transition group-open:rotate-180" />
      </summary>
      <form action={selectCampaignAction} className="absolute left-0 z-30 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-surface-2 p-1 shadow-2xl">
        {options.map((o) => {
          const active = (o.id === "all" && !current) || o.id === current?.id;
          return (
            <button
              key={o.id}
              type="submit"
              name="campaignId"
              value={o.id}
              className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-3", active && "text-accent")}
            >
              <span className="truncate">{o.name}</span>
              {active ? <Check className="size-4" /> : null}
            </button>
          );
        })}
      </form>
    </details>
  );
}
