import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * Get the current session user. `cache()` dedupes calls within one render.
 * Returns null if not signed in.
 *
 * Uses getSession() (local JWT read) not getUser() (network call) because the
 * middleware already validated the JWT on this request via getUser(). Reading
 * the session from the cookie is safe here and avoids a redundant round-trip.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  return session.user;
});

/**
 * Same as `getCurrentUser` but redirects to /sign-in if unauthenticated.
 * Use in server components / actions / handlers that require auth.
 */
export async function requireUser(redirectTo?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const search = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    redirect(`/sign-in${search}`);
  }
  return user;
}
