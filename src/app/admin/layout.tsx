import { count, eq } from "drizzle-orm";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { AdminNav } from "@/components/admin-nav";
import { Logo } from "@/components/logo";
import { db } from "@/db";
import { payouts, posts } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const [[v], [p]] = await Promise.all([
    db.select({ n: count() }).from(posts).where(eq(posts.status, "pending")),
    db.select({ n: count() }).from(payouts).where(eq(payouts.status, "requested")),
  ]);
  const counts = { videos: v?.n ?? 0, payouts: p?.n ?? 0 };

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface/60 p-4 md:flex">
        <div className="px-2 py-1.5">
          <Logo />
          <p className="mt-1 text-xs text-subtle">Admin</p>
        </div>
        <div className="mt-6 flex-1">
          <AdminNav counts={counts} orientation="vertical" />
        </div>
        <div className="border-t border-line pt-3">
          <p className="truncate px-2 text-sm">{admin.name}</p>
          <p className="truncate px-2 text-xs text-subtle">{admin.email}</p>
          <form action={logoutAction}>
            <button type="submit" className="mt-2 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="safe-top sticky top-0 z-30 border-b border-line bg-black/80 px-4 pb-2 pt-3 backdrop-blur-xl md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <Logo />
            <span className="text-xs text-subtle">Admin</span>
          </div>
          <AdminNav counts={counts} orientation="horizontal" />
        </header>
        {env.simulatePayouts ? (
          <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
            Simulation mode — Stripe and PayPal calls are faked (PAYOUTS_SIMULATE=true). No real money moves.
          </div>
        ) : null}
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
