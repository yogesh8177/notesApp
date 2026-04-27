import Link from "next/link";
import { requireOrgRole } from "@/lib/auth/org";
import { Separator } from "@/components/ui/separator";

/**
 * Org-scoped layout. Every route under /orgs/[orgId] gets the auth gate +
 * navigation here. Module agents must NOT add new auth checks at the page
 * level — `requireOrgRole` here is sufficient for read access; mutations
 * still need `assertCanWriteNote` etc. at the action site.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const ctx = await requireOrgRole(orgId, "viewer");

  return (
    <div className="min-h-screen">
      <header className="border-b bg-background">
        <div className="container mx-auto flex h-14 items-center gap-4 px-4">
          <Link href="/orgs" className="text-sm font-semibold">
            Orgs
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <nav className="flex items-center gap-4 text-sm">
            <Link href={`/orgs/${orgId}/notes`} className="hover:underline">
              Notes
            </Link>
            <Link href={`/orgs/${orgId}/search`} className="hover:underline">
              Search
            </Link>
            <Link href={`/orgs/${orgId}/files`} className="hover:underline">
              Files
            </Link>
            <Link href={`/orgs/${orgId}/settings`} className="hover:underline">
              Settings
            </Link>
          </nav>
          <div className="ml-auto text-xs text-muted-foreground">role: {ctx.role}</div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
