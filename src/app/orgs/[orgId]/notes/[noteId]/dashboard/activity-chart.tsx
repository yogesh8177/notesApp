"use client";

import type { NoteVersionSummary } from "@/lib/notes";

// ---------------------------------------------------------------------------
// Data builder (pure function — testable outside React)
// ---------------------------------------------------------------------------

export interface ActivityBar {
  label: string;
  count: number;
  maxCount: number;
}

/**
 * Bucket history entries into hourly or daily slots.
 * Uses hourly buckets when the span of history is < 24 h,
 * daily buckets otherwise.
 */
export function buildActivityBars(history: NoteVersionSummary[]): ActivityBar[] {
  if (history.length === 0) return [];

  const dates = history.map((v) => v.createdAt.getTime());
  const minTs = Math.min(...dates);
  const maxTs = Math.max(...dates);
  const spanMs = maxTs - minTs;
  const useHourly = spanMs < 24 * 60 * 60 * 1000;

  // Build a map from bucket key → count
  const buckets = new Map<string, number>();

  for (const v of history) {
    const d = v.createdAt;
    const key = useHourly
      ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  // Sort keys chronologically and produce labels
  const sortedKeys = Array.from(buckets.keys()).sort();

  const bars = sortedKeys.map((key): Omit<ActivityBar, "maxCount"> => {
    const count = buckets.get(key) ?? 0;
    // Shorten the label for display
    const label = useHourly
      ? key.split(" ")[1] // "HH:00"
      : key.slice(5); // "MM-DD"
    return { label, count };
  });

  const maxCount = Math.max(...bars.map((b) => b.count));
  return bars.map((b) => ({ ...b, maxCount }));
}

// ---------------------------------------------------------------------------
// SVG chart component
// ---------------------------------------------------------------------------

const SVG_W = 400;
const SVG_H = 80;
const BAR_AREA_H = 56; // height available for bars
const LABEL_Y = 75; // y position for x-axis labels
const BAR_GAP = 2;

export function ActivityChart({ history }: { history: NoteVersionSummary[] }) {
  const bars = buildActivityBars(history);

  if (bars.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        aria-label="No checkpoint history"
        className="block"
      >
        <text
          x={SVG_W / 2}
          y={SVG_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={12}
          fill="currentColor"
          className="text-muted-foreground"
          opacity={0.5}
        >
          No checkpoint history
        </text>
      </svg>
    );
  }

  const n = bars.length;
  const barW = Math.max(4, Math.floor((SVG_W - BAR_GAP * (n + 1)) / n));
  const slotW = barW + BAR_GAP;
  // Center the bar group horizontally
  const totalW = slotW * n + BAR_GAP;
  const offsetX = Math.max(0, (SVG_W - totalW) / 2);

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      width="100%"
      aria-label="Checkpoint activity chart"
      className="block overflow-visible"
    >
      {bars.map((bar, i) => {
        const ratio = bar.maxCount > 0 ? bar.count / bar.maxCount : 0;
        const barH = Math.max(2, Math.round(ratio * BAR_AREA_H));
        const x = offsetX + BAR_GAP + i * slotW;
        const y = BAR_AREA_H - barH;
        // Opacity: 0.3 for min, 1.0 for max
        const opacity = 0.3 + ratio * 0.7;

        return (
          <g key={bar.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill="hsl(var(--primary))"
              opacity={opacity}
              rx={1}
            >
              <title>
                {bar.label}: {bar.count} checkpoint{bar.count !== 1 ? "s" : ""}
              </title>
            </rect>
            {/* Only render label when there's reasonable space (max 20 bars) */}
            {n <= 20 && (
              <text
                x={x + barW / 2}
                y={LABEL_Y}
                textAnchor="middle"
                fontSize={8}
                fill="currentColor"
                opacity={0.6}
                className="text-muted-foreground"
              >
                {bar.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
