// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityBar {
  label: string;
  count: number;
  maxCount: number;
}

// ---------------------------------------------------------------------------
// SVG chart component — accepts pre-computed bars, no date math here
// ---------------------------------------------------------------------------

const SVG_W = 400;
const SVG_H = 80;
const BAR_AREA_H = 56;
const LABEL_Y = 75;
const BAR_GAP = 2;

export function ActivityChart({ bars }: { bars: ActivityBar[] }) {
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
