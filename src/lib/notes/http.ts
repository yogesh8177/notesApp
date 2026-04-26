import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { err, type Err } from "@/lib/validation/result";

export async function requireApiUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: err("UNAUTHORIZED", "Authentication required.") };
  }

  return { user, error: null };
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, input: Record<string, string | undefined>) {
  return schema.safeParse(input);
}

export async function parseJson<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<
  | { success: true; data: z.infer<T> }
  | { success: false; error: Err }
> {
  try {
    const json = await request.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return { success: false, error: err("VALIDATION", "Invalid input", parsed.error.flatten().fieldErrors as Record<string, string[]>) };
    }
    return { success: true, data: parsed.data };
  } catch {
    return { success: false, error: err("VALIDATION", "Invalid JSON body") };
  }
}
