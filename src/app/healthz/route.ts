import { NextResponse } from "next/server";

/**
 * Liveness/readiness endpoint for Railway.
 * Intentionally does NOT touch the DB — keeps a deploy alive even if Postgres
 * blips, and lets us tell apart "container up" from "DB up".
 *
 * For DB liveness, see /readyz (deploy-ops module agent will add).
 */
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
