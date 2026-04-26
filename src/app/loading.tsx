import { Skeleton } from "@/components/ui/skeleton";

export default function RootLoading() {
  return (
    <div
      className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
