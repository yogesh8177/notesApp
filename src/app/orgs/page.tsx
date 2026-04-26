import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listMyOrgs } from "@/lib/auth/org";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Your orgs — Notes" };

/**
 * Org picker. Lands here after sign-in if the user has multiple orgs.
 * If they have exactly one, the org-admin module's logic redirects directly.
 *
 * Org creation form lives at /orgs/new (org-admin module owns).
 */
export default async function OrgsPage() {
  const user = await requireUser("/orgs");
  const orgs = await listMyOrgs(user.id);

  return (
    <main className="container mx-auto max-w-3xl py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your organisations</h1>
        <Button asChild>
          <Link href="/orgs/new">Create org</Link>
        </Button>
      </div>

      {orgs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No organisations yet</CardTitle>
            <CardDescription>Create one to start taking notes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/orgs/new">Create your first org</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={`/orgs/${o.id}/notes`} className="block">
                <Card className="transition hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle>{o.name}</CardTitle>
                    <CardDescription>
                      {o.slug} · role: {o.role}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
