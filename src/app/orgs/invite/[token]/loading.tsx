import { Skeleton } from "@/components/ui/skeleton";

export default function AcceptInviteLoading() {
  return (
    <main className="mx-auto max-w-md py-16 px-4 text-center space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading invitation…</span>
      <Skeleton className="mx-auto h-8 w-40" />
      <Skeleton className="mx-auto h-4 w-64" />
      <Skeleton className="mx-auto h-9 w-48" />
    </main>
  );
}
