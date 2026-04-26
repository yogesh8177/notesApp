import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NoteHistoryLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading history…</span>

      {/* Title + nav */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Diff card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>

      {/* All versions card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-8 w-36" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
