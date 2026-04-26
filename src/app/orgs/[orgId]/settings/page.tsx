/**
 * STUB — owned by `org-admin` module agent.
 *
 * Replace with: org name/slug edit, member list, role change UI, invite
 * (email + role) flow with token link, accept-invite page, leave org.
 *
 * Permission check: requireOrgRole(orgId, "admin") at top of mutations.
 */
import { requireOrgRole } from "@/lib/auth/org";

export default async function SettingsStub({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireOrgRole(orgId, "viewer");
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-sm text-muted-foreground">
        Stub — org-admin agent will replace this. orgId: <code>{orgId}</code>
      </p>
    </div>
  );
}
