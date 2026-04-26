import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NotesListLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading notes…</span>

      {/* Page heading */}
      <div className="space-y-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Filters card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}
            <Skeleton className="h-9 w-32 md:col-span-4" />
          </div>
        </CardContent>
      </Card>

      {/* Note cards */}
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="gap-2 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
