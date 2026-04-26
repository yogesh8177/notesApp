import { Skeleton } from "@/components/ui/skeleton";

export default function OrgSettingsLoading() {
  return (
    <main className="mx-auto max-w-3xl py-12 px-4 space-y-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading settings…</span>

      {/* Org name */}
      <section className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-24" />
      </section>

      {/* Members list */}
      <section className="space-y-3">
        <Skeleton className="h-6 w-24" />
        <div className="border rounded divide-y">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      </section>

      {/* Invite form */}
      <section className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <div className="flex gap-2 flex-wrap">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </section>

      {/* Danger zone */}
      <section className="space-y-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-9 w-44" />
      </section>
    </main>
  );
}
