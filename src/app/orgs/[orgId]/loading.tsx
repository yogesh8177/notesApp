import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function OrgSectionLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
