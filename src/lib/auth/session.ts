import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

/**
 * Get the current session user. `cache()` dedupes calls within one render.
 * Returns null if not signed in.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
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
