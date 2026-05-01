import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentDashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading agent dashboard…</span>

      {/* Session info card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </CardContent>
      </Card>

      {/* Done card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardContent>
      </Card>

      {/* History card */}
      <Card>
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
