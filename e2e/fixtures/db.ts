/**
 * Test database helpers — use Supabase Admin API to provision / teardown
 * users and orgs without going through the UI or needing magic-link email.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

export const adminSupabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let _sql: ReturnType<typeof postgres> | null = null;
export function getSql() {
  if (!_sql) _sql = postgres(DATABASE_URL, { max: 2, prepare: false });
  return _sql;
}

export async function closeSql() {
  if (_sql) { await _sql.end(); _sql = null; }
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export interface TestOrg {
  id: string;
  slug: string;
}

/** Create a Supabase auth user + public.users row with a known password. */
export async function createTestUser(emailPrefix: string): Promise<TestUser> {
  const email = `${emailPrefix}-${Date.now()}@e2e.test`;
  const password = "TestPass123!";

  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createTestUser: ${error?.message}`);

  const sql = getSql();
  await sql.unsafe(
    `INSERT INTO users (id, email) VALUES ('${data.user.id}', '${email}') ON CONFLICT (id) DO NOTHING`,
  );

  return { id: data.user.id, email, password };
}

/** Create an org and add userId as owner. */
export async function createTestOrg(userId: string, namePrefix: string): Promise<TestOrg> {
  const slug = `${namePrefix}-${Date.now()}`;
  const sql = getSql();

  const [org] = await sql.unsafe(
    `INSERT INTO orgs (name, slug, created_by)
     VALUES ('${namePrefix} Org', '${slug}', '${userId}')
     RETURNING id, slug`,
  ) as Array<{ id: string; slug: string }>;

  await sql.unsafe(
    `INSERT INTO memberships (org_id, user_id, role)
     VALUES ('${org.id}', '${userId}', 'owner')
     ON CONFLICT DO NOTHING`,
  );

  return { id: org.id, slug: org.slug };
}

/** Add an existing user to an org as member. */
export async function addMember(orgId: string, userId: string, role = "member") {
  const sql = getSql();
  await sql.unsafe(
    `INSERT INTO memberships (org_id, user_id, role)
     VALUES ('${orgId}', '${userId}', '${role}')
     ON CONFLICT DO NOTHING`,
  );
}

/** Hard-delete a test org and all its data (notes, memberships). */
export async function deleteTestOrg(orgId: string) {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE org_id = '${orgId}')`);
  await sql.unsafe(`DELETE FROM note_shares WHERE note_id IN (SELECT id FROM notes WHERE org_id = '${orgId}')`);
  await sql.unsafe(`DELETE FROM notes WHERE org_id = '${orgId}'`);
  await sql.unsafe(`DELETE FROM memberships WHERE org_id = '${orgId}'`);
  await sql.unsafe(`DELETE FROM orgs WHERE id = '${orgId}'`);
}

/** Delete a Supabase auth user and the public.users row. */
export async function deleteTestUser(userId: string) {
  const sql = getSql();
  await sql.unsafe(`DELETE FROM users WHERE id = '${userId}'`);
  await adminSupabase.auth.admin.deleteUser(userId);
}
