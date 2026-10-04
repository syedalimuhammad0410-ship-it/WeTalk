import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

const toneClasses: Record<Tone, string> = {
  slate: "bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300",
  zinc: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400",
  blue: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  sky: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  indigo: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
  violet: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  emerald: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  green: "bg-green-500/10 text-green-700 ring-green-500/20 dark:text-green-300",
  teal: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
  cyan: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  amber: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  yellow: "bg-yellow-500/10 text-yellow-700 ring-yellow-500/25 dark:text-yellow-300",
  orange: "bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300",
  red: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300",
  rose: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
};

export function Badge({ tone = "slate", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", toneClasses[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wider text-faint">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-subtle text-muted">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded-md bg-subtle before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent dark:before:via-white/5", className)} />;
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-subtle", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; href?: string }) {
  const inner = (
    <div className="card group h-full p-4 transition-colors hover:border-faint/50">
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>{label}</span>
        {icon && <span className="text-faint transition-colors group-hover:text-accent">{icon}</span>}
      </div>
      <div className="mt-2 text-[26px] font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? (
    <a href={href} className="block focus-visible:outline-offset-4">
      {inner}
    </a>
  ) : (
    inner
  );
}

export function ScoreBadge({ score, label }: { score: number | null | undefined; label?: string }) {
  if (score == null) return <span className="text-sm text-faint">—</span>;
  const tone = score < 35 ? "text-red-600 dark:text-red-400" : score < 50 ? "text-orange-600 dark:text-orange-400" : score < 65 ? "text-amber-600 dark:text-amber-400" : score < 80 ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400";
  return (
    <span className={cn("font-semibold tabular-nums", tone)} title={label}>
      {score}
    </span>
  );
}

export function ScoreBar({ label, value, explanation }: { label: string; value: number | null | undefined; explanation?: string }) {
  const v = value ?? 0;
  const color = v < 35 ? "bg-red-500" : v < 50 ? "bg-orange-500" : v < 65 ? "bg-amber-500" : v < 80 ? "bg-blue-500" : "bg-green-500";
  return (
    <div title={explanation}>
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">{value ?? "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <div className={cn("h-full rounded-full transition-[width] duration-700", color)} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function ScoreRing({ value, size = 72, label }: { value: number | null | undefined; size?: number; label?: string }) {
  const v = value ?? 0;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = value == null ? "rgb(var(--faint))" : v < 35 ? "#ef4444" : v < 50 ? "#f97316" : v < 65 ? "#f59e0b" : v < 80 ? "#3b82f6" : "#22c55e";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"}: ${value ?? "not available"} out of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--subtle))" strokeWidth={6} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * v) / 100} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <span className="absolute text-lg font-semibold tabular-nums">{value ?? "—"}</span>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Alert({ tone = "info", title, children, action, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const t = { info: "border-blue-500/25 bg-blue-500/5", warning: "border-amber-500/30 bg-amber-500/5", danger: "border-red-500/30 bg-red-500/5", success: "border-green-500/30 bg-green-500/5" }[tone];
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between", t, className)} role={tone === "danger" ? "alert" : "status"}>
      <div>
        {title && <div className="font-medium">{title}</div>}
        {children && <div className="text-muted">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
