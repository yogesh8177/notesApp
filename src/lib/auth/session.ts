import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * Get the current authenticated user. `cache()` dedupes calls within one render.
 * Returns null if not signed in.
 *
 * Uses getUser() (contacts Supabase Auth server) to guarantee the token is
 * authentic. cache() ensures this is at most one network call per render tree.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
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
