import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { SubmitButton } from "@/app/orgs/_components/submit-button";
import { getMembership } from "@/lib/auth/org";
import { listMembers, listPendingInvites, inviteMember, changeRole, leaveOrg } from "@/lib/orgs";
import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from "@/lib/agent-tokens";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgs } from "@/lib/db/schema";
import { CopyInviteLink } from "./_components/copy-invite-link";
import { AgentTokensSection } from "./_components/agent-tokens-section";
import { CreatedTokenBanner } from "./_components/created-token-banner";

const NEW_TOKEN_COOKIE = "agent_token_just_created";

interface Props {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export const metadata = { title: "Organisation Settings" };

export default async function OrgSettingsPage({ params, searchParams }: Props) {
  const { orgId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/orgs/${orgId}/settings`);

  const [membership, members, pendingInvites, [org], tokensResult] = await Promise.all([
    getMembership(orgId, user.id),
    listMembers(orgId),
    listPendingInvites(orgId),
    db.select({ id: orgs.id, name: orgs.name, slug: orgs.slug }).from(orgs).where(eq(orgs.id, orgId)).limit(1),
    listAgentTokens(orgId, user.id).catch(() => null),
  ]);

  if (!membership || !org) {
    return <p className="p-8 text-destructive">Organisation not found.</p>;
  }

  const isAdmin = membership.role === "admin" || membership.role === "owner";

  const message = first(query.message);
  const error = first(query.error);

  async function handleInvite(formData: FormData) {
    "use server";
    const result = await inviteMember(orgId, {
      email: String(formData.get("email") ?? ""),
      role: String(formData.get("role") ?? "member") as "admin" | "member" | "viewer",
    });
    if (!result.ok) {
      redirect(`/orgs/${orgId}/settings?error=${encodeURIComponent(result.message)}`);
    }
    redirect(`/orgs/${orgId}/settings?message=${encodeURIComponent("Invite sent — link logged to audit trail.")}`);
  }

  async function handleRoleChange(formData: FormData) {
    "use server";
    const result = await changeRole(orgId, {
      userId: String(formData.get("userId") ?? ""),
      role: String(formData.get("role") ?? "member") as "owner" | "admin" | "member" | "viewer",
    });
    if (!result.ok) {
      redirect(`/orgs/${orgId}/settings?error=${encodeURIComponent(result.message)}`);
    }
    redirect(`/orgs/${orgId}/settings?message=${encodeURIComponent("Role updated.")}`);
  }

  async function handleLeave() {
    "use server";
    const result = await leaveOrg(orgId);
    if (!result.ok) {
      redirect(`/orgs/${orgId}/settings?error=${encodeURIComponent(result.message)}`);
    }
    redirect("/orgs");
  }

  async function handleCreateAgentToken(formData: FormData) {
    "use server";
    const u = await requireUser(`/orgs/${orgId}/settings`);
    const result = await createAgentToken(
      {
        orgId,
        userId: String(formData.get("userId") ?? ""),
        name: String(formData.get("name") ?? ""),
      },
      u.id,
    );
    if (!result.ok) {
      redirect(
        `/orgs/${orgId}/settings?error=${encodeURIComponent(result.message)}`,
      );
    }
    // Stash the cleartext in a short-lived HttpOnly cookie. The page reads
    // it once at render and clears it. Cookie never leaves the browser →
    // server roundtrip, so it's not in URLs, history, or referrer headers.
    (await cookies()).set(NEW_TOKEN_COOKIE, JSON.stringify({
      cleartext: result.data.cleartext,
      name: result.data.name,
    }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      // Short — the redirect is the only consumer. We can't clear this cookie
      // during the page render (Next.js forbids cookie mutation outside Server
      // Actions / Route Handlers), so the TTL is the cleanup mechanism. Window
      // during which a refresh re-shows the banner = this many seconds.
      maxAge: 30,
      path: `/orgs/${orgId}/settings`,
    });
    redirect(
      `/orgs/${orgId}/settings?message=${encodeURIComponent("Token created. Copy it now.")}`,
    );
  }

  async function handleRevokeAgentToken(formData: FormData) {
    "use server";
    const u = await requireUser(`/orgs/${orgId}/settings`);
    const tokenId = String(formData.get("tokenId") ?? "");
    const result = await revokeAgentToken(orgId, tokenId, u.id);
    if (!result.ok) {
      redirect(
        `/orgs/${orgId}/settings?error=${encodeURIComponent(result.message)}`,
      );
    }
    redirect(
      `/orgs/${orgId}/settings?message=${encodeURIComponent("Token revoked.")}`,
    );
  }

  // Read the one-shot cleartext cookie set by handleCreateAgentToken.
  // We can't clear it here — Next.js 15 forbids cookie mutation during a
  // Server Component render. The short maxAge (set when this cookie is
  // written) is what cleans up; if the user refreshes within that window
  // they'll see the same banner again, which is harmless (same value
  // they already copied) and bounded by the TTL.
  const cookieStore = await cookies();
  const newTokenCookie = cookieStore.get(NEW_TOKEN_COOKIE);
  let newToken: { cleartext: string; name: string } | null = null;
  if (newTokenCookie) {
    try {
      newToken = JSON.parse(newTokenCookie.value);
    } catch {
      // Corrupt cookie — render without the banner; cookie expires shortly.
    }
  }

  const tokens = tokensResult?.ok ? tokensResult.data : [];

  return (
    <main className="mx-auto max-w-3xl py-12 px-4 space-y-10">
      {/* Org details */}
      <section>
        <h1 className="text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-muted-foreground font-mono">/{org.slug}</p>
      </section>

      {/* Flash notices */}
      {message && (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Member list */}
      <section>
        <h2 className="text-lg font-medium mb-3">Members</h2>
        <div className="border rounded divide-y text-sm">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="font-medium">{m.displayName ?? m.email}</p>
                <p className="text-muted-foreground text-xs">{m.email}</p>
              </div>
              {isAdmin && m.userId !== user.id ? (
                <form action={handleRoleChange} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={m.userId} />
                  <select name="role" defaultValue={m.role} className="border rounded px-2 py-1 text-xs">
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <SubmitButton className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded hover:opacity-80" pendingText="…">
                    Save
                  </SubmitButton>
                </form>
              ) : (
                <span className="text-xs capitalize text-muted-foreground">{m.role}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Invite form (admins only) */}
      {isAdmin && (
        <section>
          <h2 className="text-lg font-medium mb-3">Invite member</h2>
          <form action={handleInvite} className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="text-sm block mb-1" htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder="colleague@example.com"
                className="border rounded px-3 py-2 text-sm w-64"
              />
            </div>
            <div>
              <label className="text-sm block mb-1" htmlFor="invite-role">Role</label>
              <select id="invite-role" name="role" className="border rounded px-3 py-2 text-sm">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <SubmitButton className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium hover:opacity-90" pendingText="Sending…">
              Send invite
            </SubmitButton>
          </form>

          {pendingInvites.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium mb-2 text-muted-foreground">Pending invites</h3>
              <div className="border rounded divide-y text-sm">
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="flex-1">{inv.email}</span>
                    <span className="text-xs capitalize text-muted-foreground">{inv.role}</span>
                    <span className="text-xs text-muted-foreground">expires {inv.expiresAt.toLocaleDateString()}</span>
                    <CopyInviteLink token={inv.token} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Agent tokens (admins only) */}
      {isAdmin && (
        <>
          {newToken && (
            <CreatedTokenBanner
              cleartext={newToken.cleartext}
              name={newToken.name}
            />
          )}
          <AgentTokensSection
            tokens={tokens}
            members={members}
            createAction={handleCreateAgentToken}
            revokeAction={handleRevokeAgentToken}
          />
        </>
      )}

      {/* Leave org */}
      <section>
        <h2 className="text-lg font-medium mb-2">Danger zone</h2>
        <form action={handleLeave}>
          <SubmitButton className="text-sm text-destructive border border-destructive rounded px-4 py-2 hover:bg-destructive/10" pendingText="Leaving…">
            Leave organisation
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
