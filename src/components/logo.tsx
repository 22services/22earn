import { cn } from "./ui";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8", className)}>
      <rect width="64" height="64" rx="15" fill="#C6F432" />
      <path d="M14 46 L30 30 L38 38 L52 22" fill="none" stroke="#0A0A0A" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M41 21 H53 V33" fill="none" stroke="#0A0A0A" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark className={size === "lg" ? "size-10" : "size-7"} />
      <span className={cn("font-bold tracking-tight", size === "lg" ? "text-2xl" : "text-lg")}>
        22<span className="text-accent">earn</span>
      </span>
    </span>
  );
}
