import type { NoteVersionSummary } from "@/lib/notes";
import type { ActivityBar } from "./activity-chart";

export function buildActivityBars(history: NoteVersionSummary[]): ActivityBar[] {
  if (history.length === 0) return [];

  const dates = history.map((v) => v.createdAt.getTime());
  const minTs = Math.min(...dates);
  const maxTs = Math.max(...dates);
  const spanMs = maxTs - minTs;
  const useHourly = spanMs < 24 * 60 * 60 * 1000;

  const buckets = new Map<string, number>();

  for (const v of history) {
    const d = v.createdAt;
    const key = useHourly
      ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const sortedKeys = Array.from(buckets.keys()).sort();

  const bars = sortedKeys.map((key): Omit<ActivityBar, "maxCount"> => {
    const count = buckets.get(key) ?? 0;
    const label = useHourly ? key.split(" ")[1] : key.slice(5);
    return { label, count };
  });

  const maxCount = Math.max(...bars.map((b) => b.count));
  return bars.map((b) => ({ ...b, maxCount }));
}
