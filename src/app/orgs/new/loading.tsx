import { Skeleton } from "@/components/ui/skeleton";

export default function NewOrgLoading() {
  return (
    <main className="mx-auto max-w-md py-16 px-4 space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      <div className="space-y-4">
        <div className="space-y-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
    </main>
  );
}
