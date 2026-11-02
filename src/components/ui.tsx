import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ card */

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex items-center justify-between gap-4 px-5 py-4", className)}>{children}</div>;
}

/* --------------------------------------------------------------- buttons */

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";
const buttonVariants = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong",
  outline: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  subtle: "bg-surface-3 text-fg hover:bg-line",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};
const buttonSizes = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-4 text-[15px]",
  lg: "h-14 px-5 text-base",
};

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/** Small rounded chip, like the "Whop" / "Summer Clips" pills in the reference. */
export function Pill({ className, children, ...rest }: ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1 text-[13px] font-medium text-fg", className)}
      {...rest}
    >
      {children}
    </span>
  );
}

const badgeTones = {
  neutral: "bg-surface-3 text-muted",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
  accent: "bg-accent/15 text-accent",
};
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- forms */

export function Label({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-[13px] font-medium text-muted", className)} {...rest} />;
}

const fieldClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-fg placeholder:text-subtle outline-none transition focus:border-accent/70 focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-11", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cn(fieldClass, "h-11 appearance-none bg-[length:16px] bg-[right_0.9rem_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238d8d95' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-24", className)} {...rest} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>
        {label}
        {children}
      </Label>
      {hint ? <p className="-mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- layout */

export function PageTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-3", className)}>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{children}</h1>
      {action}
    </div>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2.5 mt-7 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 grid size-12 place-items-center rounded-2xl bg-surface-3 text-muted">{icon}</div> : null}
      <p className="font-semibold">{title}</p>
      {children ? <div className="max-w-xs text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "accent" | "warning" | "danger" }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-2xl font-bold tracking-tight",
          tone === "accent" && "text-accent",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- avatar */

const gradients = [
  "from-orange-400 to-rose-500",
  "from-lime-300 to-emerald-500",
  "from-sky-400 to-indigo-500",
  "from-fuchsia-400 to-purple-600",
  "from-amber-300 to-orange-500",
  "from-teal-300 to-cyan-600",
];

export function Avatar({ name, src, size = 48, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const clean = name.replace(/^@/, "");
  const initials = clean
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const hash = [...clean].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />
  ) : (
    <div
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-black/80", gradients[hash % gradients.length], className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || "?"}
    </div>
  );
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-accent" : "bg-fg/80")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode; className?: string }) {
  const tones = {
    info: "border-info/25 bg-info/8 text-info",
    warning: "border-warning/25 bg-warning/8 text-warning",
    danger: "border-danger/25 bg-danger/8 text-danger",
    success: "border-success/25 bg-success/8 text-success",
  };
  return <div className={cn("rounded-2xl border px-4 py-3 text-sm", tones[tone], className)}>{children}</div>;
}
