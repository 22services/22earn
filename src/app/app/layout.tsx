import { BottomNav } from "@/components/bottom-nav";
import { requireInfluencer } from "@/lib/auth";

export default async function InfluencerLayout({ children }: { children: React.ReactNode }) {
  await requireInfluencer();
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <main className="safe-top px-4 pb-32 pt-5">{children}</main>
      <BottomNav />
    </div>
  );
}
