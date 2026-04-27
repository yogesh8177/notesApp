import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/log/audit";
import { publicUrl } from "@/lib/auth/public-url";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  if (user) {
    await audit({
      action: "auth.signout",
      userId: user.id,
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
  }
  return NextResponse.redirect(publicUrl("/sign-in", request), { status: 303 });
}
