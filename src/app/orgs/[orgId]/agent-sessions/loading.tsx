import { Skeleton } from "@/components/ui/skeleton";

export default function AgentSessionsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading agent sessions…</span>

      <div className="space-y-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3">
                <Skeleton className="h-3 w-16" />
              </th>
              <th className="px-4 py-3">
                <Skeleton className="h-3 w-14" />
              </th>
              <th className="px-4 py-3">
                <Skeleton className="h-3 w-12" />
              </th>
              <th className="px-4 py-3">
                <Skeleton className="h-3 w-10" />
              </th>
              <th className="px-4 py-3">
                <Skeleton className="h-3 w-20" />
              </th>
              <th className="px-4 py-3">
                <Skeleton className="h-3 w-16" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {[0, 1, 2, 3, 4].map((i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-48" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-8 mx-auto" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-16" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-12" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
