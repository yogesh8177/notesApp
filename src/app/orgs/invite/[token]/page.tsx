import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { acceptInvite } from "@/lib/orgs";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "Accept Invitation" };

export default async function AcceptInvitePage({ params }: Props) {
  const { token } = await params;

  // If unauthenticated, redirect to sign-in preserving the invite URL.
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/sign-in?redirect_to=${encodeURIComponent(`/orgs/invite/${token}`)}`);
  }

  // Optimistically attempt the accept.
  const result = await acceptInvite(token);

  if (result.ok) {
    redirect(`/orgs/${result.data.orgId}/notes`);
  }

  // Error states: expired, wrong user, already accepted, not found.
  const isMismatch = result.error?.code === "FORBIDDEN";

  return (
    <main className="mx-auto max-w-md py-16 px-4 text-center space-y-4">
      <h1 className="text-2xl font-semibold">Invitation</h1>

      <p className="text-destructive">{result.error?.message ?? "Something went wrong."}</p>

      {isMismatch && (
        <form action="/auth/sign-out" method="POST">
          <button
            type="submit"
            className="text-sm underline text-muted-foreground hover:text-foreground"
          >
            Sign out and use a different account
          </button>
        </form>
      )}

      <a href="/orgs" className="block text-sm text-primary hover:underline">
        Go to your organisations
      </a>
    </main>
  );
}
