"use client";

import { Clapperboard, Flame, Settings, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

const tabs = [
  { href: "/app", label: "Today", icon: Flame, exact: true },
  { href: "/app/videos", label: "Videos", icon: Clapperboard },
  { href: "/app/earnings", label: "Earnings", icon: Wallet },
  { href: "/app/accounts", label: "Accounts", icon: Users },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-black/80 backdrop-blur-xl" aria-label="Main">
      <ul className="mx-auto grid max-w-md grid-cols-5 px-2 pt-1.5">
        {tabs.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition", active ? "text-fg" : "text-subtle hover:text-muted")}
              >
                <Icon className={cn("size-[22px]", active && "text-accent")} strokeWidth={active ? 2.4 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
