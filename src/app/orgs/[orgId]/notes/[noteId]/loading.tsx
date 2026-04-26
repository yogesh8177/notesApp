import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NoteDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading note…</span>

      {/* Title + nav */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Edit note card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-48 w-full" />
          <div className="grid gap-3 md:grid-cols-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>

      {/* Sharing card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9 w-36" />
          </div>
        </CardContent>
      </Card>

      {/* Recent versions card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
