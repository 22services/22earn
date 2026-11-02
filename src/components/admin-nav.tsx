"use client";

import { Clapperboard, LayoutDashboard, Megaphone, Settings, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

const items = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/influencers", label: "Creators", icon: Users },
  { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/admin/videos", label: "Videos", icon: Clapperboard, badge: "videos" as const },
  { href: "/admin/payouts", label: "Payouts", icon: Wallet, badge: "payouts" as const },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminNav({ counts, orientation }: { counts: { videos: number; payouts: number }; orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className={cn(orientation === "vertical" ? "space-y-1" : "no-scrollbar flex gap-1 overflow-x-auto")}>
        {items.map(({ href, label, icon: Icon, exact, badge }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          const count = badge ? counts[badge] : 0;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                  active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon className={cn("size-[18px]", active && "text-accent")} />
                {label}
                {count > 0 ? <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">{count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
