import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Health classification
// ---------------------------------------------------------------------------

export type HealthStatus = "active" | "recent" | "stale" | "blocked";

export function classifyHealth(lastUpdated: Date, issueCount: number): HealthStatus {
  if (issueCount > 0) return "blocked";
  const ageMs = Date.now() - lastUpdated.getTime();
  const twoHours = 2 * 60 * 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;
  if (ageMs < twoHours) return "active";
  if (ageMs < oneDay) return "recent";
  return "stale";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  HealthStatus,
  { dot: string; label: string; pulse: boolean }
> = {
  active: {
    dot: "bg-emerald-500",
    label: "Active",
    pulse: true,
  },
  recent: {
    dot: "bg-sky-500",
    label: "Recent",
    pulse: false,
  },
  stale: {
    dot: "bg-zinc-400",
    label: "Stale",
    pulse: false,
  },
  blocked: {
    dot: "bg-amber-500",
    label: "Blocked",
    pulse: true,
  },
};

/**
 * Server component — no client state needed.
 * Renders a coloured dot + text label indicating session health.
 */
export function HealthBadge({
  lastUpdated,
  issueCount,
}: {
  lastUpdated: Date;
  issueCount: number;
}) {
  const status = classifyHealth(lastUpdated, issueCount);
  const cfg = STATUS_CONFIG[status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full shrink-0",
          cfg.dot,
          cfg.pulse && "animate-pulse",
        )}
        aria-hidden="true"
      />
      <span className="text-xs font-medium">{cfg.label}</span>
    </span>
  );
}
