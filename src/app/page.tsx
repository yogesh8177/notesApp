import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Root() {
  const user = await getCurrentUser();
  redirect(user ? "/orgs" : "/sign-in");
}
