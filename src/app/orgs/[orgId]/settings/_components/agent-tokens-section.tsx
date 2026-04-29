import { SubmitButton } from "@/app/orgs/_components/submit-button";
import type { AgentTokenSummary } from "@/lib/agent-tokens";

interface Member {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
}

interface Props {
  tokens: AgentTokenSummary[];
  members: Member[];
  createAction: (formData: FormData) => Promise<void>;
  revokeAction: (formData: FormData) => Promise<void>;
}

function formatRelative(date: Date | null): string {
  if (!date) return "never";
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Server-rendered token management section. Two responsibilities:
 *   1. Generate a new token (form posts to createAction; the parent page
 *      stashes the cleartext in a one-shot flash cookie + redirects, then
 *      renders <CreatedTokenBanner /> from the cookie).
 *   2. List existing tokens with their principal user, prefix, last-used
 *      time, and a per-row revoke button.
 */
export function AgentTokensSection({
  tokens,
  members,
  createAction,
  revokeAction,
}: Props) {
  return (
    <section>
      <h2 className="text-lg font-medium mb-3">Agent tokens</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Bearer tokens used by <code>/agent/*</code> and <code>/mcp</code>.
        Each token authenticates as a chosen org member; that user authors any
        notes the agent creates and is the principal for visibility checks.
      </p>

      <form
        action={createAction}
        className="flex flex-wrap items-end gap-2 mb-6 rounded border border-dashed p-4"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="text-sm block mb-1" htmlFor="token-name">
            Name
          </label>
          <input
            id="token-name"
            name="name"
            type="text"
            required
            maxLength={80}
            placeholder="e.g. Yogesh's MacBook"
            className="border rounded px-3 py-2 text-sm w-full"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-sm block mb-1" htmlFor="token-principal">
            Principal user
          </label>
          <select
            id="token-principal"
            name="userId"
            required
            className="border rounded px-3 py-2 text-sm w-full"
            defaultValue=""
          >
            <option value="" disabled>
              Choose a member…
            </option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName ?? m.email} ({m.role})
              </option>
            ))}
          </select>
        </div>
        <SubmitButton
          className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium hover:opacity-90"
          pendingText="Generating…"
        >
          Generate token
        </SubmitButton>
      </form>

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      ) : (
        <div className="border rounded divide-y text-sm">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  <code>nat_{t.displayPrefix}…</code>
                  {" · principal "}
                  {t.principal.displayName ?? t.principal.email}
                  {" · last used "}
                  {formatRelative(t.lastUsedAt)}
                </p>
              </div>
              {t.revoked ? (
                <span className="text-xs text-muted-foreground">revoked</span>
              ) : (
                <form action={revokeAction}>
                  <input type="hidden" name="tokenId" value={t.id} />
                  <SubmitButton
                    className="text-xs rounded border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-destructive hover:bg-destructive/20"
                    pendingText="…"
                  >
                    Revoke
                  </SubmitButton>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
