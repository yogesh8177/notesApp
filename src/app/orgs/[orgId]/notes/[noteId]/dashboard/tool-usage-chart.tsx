import { getNoteToolCallCounts } from "@/lib/timeline/queries";

const BAR_MAX_WIDTH = 300;
const ROW_HEIGHT = 20;
const ROW_GAP = 6;
const LABEL_WIDTH = 180;
const COUNT_WIDTH = 36;
const PADDING_X = 8;
const PADDING_Y = 8;

function stripPrefix(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, "");
}

interface Props {
  orgId: string;
  noteId: string;
}

export default async function ToolUsageChart({ orgId, noteId }: Props) {
  const counts = await getNoteToolCallCounts(orgId, noteId);
  if (counts.length === 0) return null;

  const maxCount = counts[0].callCount;
  const totalRows = counts.length;
  const svgHeight = PADDING_Y * 2 + totalRows * ROW_HEIGHT + (totalRows - 1) * ROW_GAP;
  const svgWidth = PADDING_X * 2 + LABEL_WIDTH + BAR_MAX_WIDTH + COUNT_WIDTH;

  return (
    <svg
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width={svgWidth}
      height={svgHeight}
      aria-label="Tool usage bar chart"
      role="img"
      className="max-w-full"
    >
      {counts.map((row, i) => {
        const y = PADDING_Y + i * (ROW_HEIGHT + ROW_GAP);
        const barWidth = maxCount > 0 ? Math.round((row.callCount / maxCount) * BAR_MAX_WIDTH) : 0;
        const shortName = stripPrefix(row.toolName);

        return (
          <g key={row.toolName}>
            {/* Tool name label */}
            <text
              x={PADDING_X}
              y={y + ROW_HEIGHT / 2}
              dominantBaseline="middle"
              fontSize={11}
              fontFamily="ui-monospace, monospace"
              fill="currentColor"
              className="fill-foreground"
            >
              {shortName.length > 22 ? shortName.slice(0, 21) + "…" : shortName}
            </text>
            {/* Bar */}
            <rect
              x={PADDING_X + LABEL_WIDTH}
              y={y + 2}
              width={barWidth}
              height={ROW_HEIGHT - 4}
              rx={2}
              fill="hsl(var(--primary))"
              opacity={0.7}
            />
            {/* Count label */}
            <text
              x={PADDING_X + LABEL_WIDTH + barWidth + 6}
              y={y + ROW_HEIGHT / 2}
              dominantBaseline="middle"
              fontSize={11}
              fontFamily="ui-sans-serif, sans-serif"
              fill="currentColor"
              className="fill-muted-foreground"
            >
              {row.callCount}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
