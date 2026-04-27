/**
 * Seed entrypoint. Owned by `seed-10k` module agent for content; baseline
 * ships the skeleton — connect, truncate, batch-insert, log.
 *
 * Usage:
 *   pnpm seed              -> small dev seed
 *   pnpm seed:large        -> SEED_NOTE_COUNT=10000
 *
 * Hard requirements (do NOT change without surfacing to orchestrator):
 *   - Use the SERVICE-ROLE Supabase client OR direct DB connection. Never
 *     run seed through the anon client; RLS will reject most inserts.
 *   - Wrap everything in a transaction so a failure leaves the DB clean.
 *   - Insert in batches of 500–1000 to keep Postgres happy.
 *   - Print summary counts at the end.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { inArray, like, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildSeedPlan,
  SEED_EMAIL_DOMAIN,
  SEED_EMAIL_PREFIX,
  SEED_ORG_SLUG_PREFIX,
  SEED_STORAGE_BUCKET,
  setFakerSeed,
} from "./factories";

const ROW_BATCH_SIZE = 500;
const STORAGE_BATCH_SIZE = 100;

interface SeedAuthUser {
  id: string;
  email: string;
  displayName: string;
}

interface UploadInput {
  path: string;
  mimeType: string;
  body: Buffer;
}

type DbClient = any;
type TxClient = any;
type ServiceClient = ReturnType<typeof createServiceClient>;

interface PreparedSeedData {
  orgRows: Array<typeof schema.orgs.$inferInsert>;
  membershipRows: Array<typeof schema.memberships.$inferInsert>;
  tagRows: Array<typeof schema.tags.$inferInsert>;
  noteRows: Array<typeof schema.notes.$inferInsert>;
  noteVersionRows: Array<typeof schema.noteVersions.$inferInsert>;
  noteTagRows: Array<typeof schema.noteTags.$inferInsert>;
  noteShareRows: Array<typeof schema.noteShares.$inferInsert>;
  fileRows: Array<typeof schema.files.$inferInsert>;
  uploads: UploadInput[];
}

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or DIRECT_URL must be set");

  const noteCount = Number(process.env.SEED_NOTE_COUNT ?? 100);
  const userCount = Number(process.env.SEED_USER_COUNT ?? 20);
  const orgCount = Number(process.env.SEED_ORG_COUNT ?? 5);

  console.log(
    `▶ seeding: ${orgCount} orgs · ${userCount} users · ${noteCount} notes`,
  );
  setFakerSeed(Number(process.env.SEED_RNG ?? 42));

  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql, { schema });
  const service = createServiceClient();
  const createdUserIds: string[] = [];
  const uploadedPaths: string[] = [];

  try {
    await cleanupPreviousSeedData(db, service);

    const plan = buildSeedPlan({ noteCount, orgCount, userCount });
    const authUsers = await createSeedUsers(service, plan.users);
    createdUserIds.push(...authUsers.map((user) => user.id));

    await waitForProfiles(db, authUsers.map((user) => user.id));

    const prepared = prepareSeedRows(plan, authUsers);

    await uploadSeedFiles(service, prepared.uploads);
    uploadedPaths.push(...prepared.uploads.map((upload) => upload.path));

    await db.transaction(async (tx) => {
      await insertBatches(tx, schema.orgs, prepared.orgRows, "org rows");
      await insertBatches(tx, schema.memberships, prepared.membershipRows, "membership rows");
      await insertBatches(tx, schema.tags, prepared.tagRows, "tag rows");
      await insertBatches(tx, schema.notes, prepared.noteRows, "note rows");
      await insertBatches(
        tx,
        schema.noteVersions,
        prepared.noteVersionRows,
        "note version rows",
      );
      await insertBatches(tx, schema.noteTags, prepared.noteTagRows, "note tag rows");
      await insertBatches(
        tx,
        schema.noteShares,
        prepared.noteShareRows,
        "note share rows",
      );
      await insertBatches(tx, schema.files, prepared.fileRows, "file rows");
    });

    console.log(
      [
        "✓ seed complete",
        `${prepared.orgRows.length} orgs`,
        `${authUsers.length} users`,
        `${prepared.membershipRows.length} memberships`,
        `${prepared.tagRows.length} tags`,
        `${prepared.noteRows.length} notes`,
        `${prepared.noteVersionRows.length} versions`,
        `${prepared.noteShareRows.length} shares`,
        `${prepared.fileRows.length} files`,
      ].join(" · "),
    );
    await printSeedSummary(db, authUsers);
  } catch (error) {
    let cleanupError: unknown = null;

    if (uploadedPaths.length > 0) {
      try {
        await removeSeedFiles(service, uploadedPaths);
      } catch (removeError) {
        cleanupError = removeError;
      }
    }
    if (createdUserIds.length > 0) {
      try {
        await deleteAuthUsers(service, createdUserIds);
      } catch (deleteError) {
        cleanupError ??= deleteError;
      }
    }

    if (cleanupError) {
      console.error("cleanup after seed failure also failed", cleanupError);
    }
    throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function prepareSeedRows(
  plan: ReturnType<typeof buildSeedPlan>,
  authUsers: SeedAuthUser[],
): PreparedSeedData {
  const orgIds = plan.orgs.map(() => randomUUID());
  const tagIdByOrgAndName = new Map<string, string>();
  const noteIds = plan.notes.map(() => randomUUID());

  const orgRows = plan.orgs.map((org, orgIdx) => ({
    id: orgIds[orgIdx],
    name: org.name,
    slug: org.slug,
    createdBy: authUsers[orgIdx % authUsers.length]?.id ?? authUsers[0].id,
  }));

  const membershipRows = plan.memberships.map((membership) => ({
    id: randomUUID(),
    orgId: orgIds[membership.orgIdx],
    userId: authUsers[membership.userIdx].id,
    role: membership.role,
  }));

  const tagRows = plan.tags.map((tag) => {
    const id = randomUUID();
    tagIdByOrgAndName.set(`${tag.orgIdx}:${tag.name}`, id);
    return {
      id,
      orgId: orgIds[tag.orgIdx],
      name: tag.name,
    };
  });

  const noteRows = plan.notes.map((note, noteIdx) => ({
    id: noteIds[noteIdx],
    orgId: orgIds[note.orgIdx],
    authorId: authUsers[note.authorIdx].id,
    title: note.title,
    content: note.content,
    visibility: note.visibility,
    currentVersion: note.versions.length,
  }));

  const noteVersionRows = plan.notes.flatMap((note, noteIdx) =>
    note.versions.map((version, versionIdx) => ({
      id: randomUUID(),
      noteId: noteIds[noteIdx],
      version: versionIdx + 1,
      title: version.title,
      content: version.content,
      visibility: note.visibility,
      changedBy: authUsers[version.authorIdx].id,
      changeSummary: version.changeSummary,
    })),
  );

  const noteTagRows = plan.notes.flatMap((note, noteIdx) =>
    note.tagNames.map((tagName) => {
      const tagId = tagIdByOrgAndName.get(`${note.orgIdx}:${tagName}`);
      if (!tagId) {
        throw new Error(`Missing tag mapping for org ${note.orgIdx} tag ${tagName}`);
      }

      return {
        noteId: noteIds[noteIdx],
        tagId,
      };
    }),
  );

  const noteShareRows = plan.shares.map((share) => {
    const note = plan.notes[share.noteIdx];
    return {
      id: randomUUID(),
      noteId: noteIds[share.noteIdx],
      sharedWithUserId: authUsers[share.withUserIdx].id,
      permission: share.permission,
      sharedBy: authUsers[note.authorIdx].id,
    };
  });

  const fileRows = plan.files.map((file) => {
    const id = randomUUID();
    return {
      id,
      orgId: orgIds[file.orgIdx],
      noteId: typeof file.noteIdx === "number" ? noteIds[file.noteIdx] : null,
      uploadedBy: authUsers[file.uploaderIdx].id,
      storagePath: `${orgIds[file.orgIdx]}/${id}/${file.fileName}`,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  });

  const uploads = plan.files.map((file, fileIdx) => ({
    path: fileRows[fileIdx].storagePath,
    mimeType: file.mimeType,
    body: file.body,
  }));

  return {
    orgRows,
    membershipRows,
    tagRows,
    noteRows,
    noteVersionRows,
    noteTagRows,
    noteShareRows,
    fileRows,
    uploads,
  };
}

async function cleanupPreviousSeedData(
  db: DbClient,
  service: ServiceClient,
) {
  const seedSlugPattern = `${SEED_ORG_SLUG_PREFIX}-%`;
  const seedEmailPattern = `${SEED_EMAIL_PREFIX}-%@${SEED_EMAIL_DOMAIN}`;

  const existingOrgs = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(like(schema.orgs.slug, seedSlugPattern));

  if (existingOrgs.length > 0) {
    const orgIds = existingOrgs.map((org) => org.id);
    const existingFiles = await db
      .select({ storagePath: schema.files.storagePath })
      .from(schema.files)
      .where(inArray(schema.files.orgId, orgIds));

    if (existingFiles.length > 0) {
      console.log(`• removing ${existingFiles.length} existing storage objects`);
      await removeSeedFiles(
        service,
        existingFiles.map((file) => file.storagePath),
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.orgs).where(like(schema.orgs.slug, seedSlugPattern));
  });

  const existingAuthUsers = await listSeedAuthUsers(service);
  if (existingAuthUsers.length > 0) {
    console.log(`• removing ${existingAuthUsers.length} existing auth users`);
    await deleteAuthUsers(
      service,
      existingAuthUsers.map((user) => user.id),
    );
  }

  const orphanSeedUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, seedEmailPattern));

  if (orphanSeedUsers.length > 0) {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.users)
        .where(inArray(schema.users.id, orphanSeedUsers.map((user) => user.id)));
    });
  }
}

async function createSeedUsers(
  service: ServiceClient,
  users: ReturnType<typeof buildSeedPlan>["users"],
): Promise<SeedAuthUser[]> {
  const created: SeedAuthUser[] = [];

  for (const user of users) {
    const { data, error } = await service.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { display_name: user.displayName },
    });
    if (error) throw error;
    if (!data.user?.id || !data.user.email) {
      throw new Error(`Supabase admin.createUser returned an incomplete user for ${user.email}`);
    }

    created.push({
      id: data.user.id,
      email: data.user.email,
      displayName: user.displayName,
    });
  }

  console.log(`• created ${created.length} auth users`);
  return created;
}

async function waitForProfiles(
  db: DbClient,
  userIds: string[],
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    const rows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));

    if (rows.length === userIds.length) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for public.users rows created by auth trigger");
}

async function listSeedAuthUsers(
  service: ServiceClient,
): Promise<Array<{ id: string; email: string }>> {
  const users: Array<{ id: string; email: string }> = [];
  let page = 1;

  while (true) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;

    const batch = (data.users ?? []).filter((user) => {
      const email = user.email ?? "";
      return email.startsWith(`${SEED_EMAIL_PREFIX}-`) && email.endsWith(`@${SEED_EMAIL_DOMAIN}`);
    });

    users.push(
      ...batch
        .filter((user) => !!user.id && !!user.email)
        .map((user) => ({ id: user.id, email: user.email! })),
    );

    if ((data.users ?? []).length < 1000) break;
    page += 1;
  }

  return users;
}

async function deleteAuthUsers(
  service: ServiceClient,
  userIds: string[],
) {
  for (const userId of userIds) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
}

async function uploadSeedFiles(
  service: ServiceClient,
  uploads: UploadInput[],
) {
  if (uploads.length === 0) return;

  console.log(`• uploading ${uploads.length} files to storage`);

  for (let start = 0; start < uploads.length; start += STORAGE_BATCH_SIZE) {
    const batch = uploads.slice(start, start + STORAGE_BATCH_SIZE);
    await Promise.all(
      batch.map(async (upload) => {
        const { error } = await service.storage
          .from(SEED_STORAGE_BUCKET)
          .upload(upload.path, upload.body, {
            contentType: upload.mimeType,
            upsert: true,
          });
        if (error) throw error;
      }),
    );

    const inserted = Math.min(start + batch.length, uploads.length);
    if (inserted % 1000 === 0 || inserted === uploads.length) {
      console.log(`  uploaded ${inserted}/${uploads.length} files`);
    }
  }
}

async function removeSeedFiles(
  service: ServiceClient,
  paths: string[],
) {
  if (paths.length === 0) return;

  for (let start = 0; start < paths.length; start += STORAGE_BATCH_SIZE) {
    const batch = paths.slice(start, start + STORAGE_BATCH_SIZE);
    const { error } = await service.storage.from(SEED_STORAGE_BUCKET).remove(batch);
    if (error) throw error;
  }
}

async function insertBatches(
  tx: TxClient,
  table: any,
  rows: Array<Record<string, unknown>>,
  label: string,
) {
  if (rows.length === 0) return;

  console.log(`• inserting ${rows.length} ${label}`);

  for (let start = 0; start < rows.length; start += ROW_BATCH_SIZE) {
    const batch = rows.slice(start, start + ROW_BATCH_SIZE);
    await tx.insert(table as never).values(batch as never);
    const inserted = Math.min(start + batch.length, rows.length);

    if (inserted % 1000 === 0 || inserted === rows.length) {
      console.log(`  inserted ${inserted}/${rows.length} ${label}`);
    }
  }
}

async function printSeedSummary(
  db: DbClient,
  authUsers: SeedAuthUser[],
) {
  const [
    orgCount,
    userCount,
    membershipCount,
    tagCount,
    noteCount,
    noteVersionCount,
    noteTagCount,
    noteShareCount,
    fileCount,
  ] = await Promise.all([
    countRows(db, schema.orgs),
    countRows(db, schema.users),
    countRows(db, schema.memberships),
    countRows(db, schema.tags),
    countRows(db, schema.notes),
    countRows(db, schema.noteVersions),
    countRows(db, schema.noteTags),
    countRows(db, schema.noteShares),
    countRows(db, schema.files),
  ]);

  console.log("table counts:");
  console.log(`  orgs: ${orgCount}`);
  console.log(`  users: ${userCount}`);
  console.log(`  memberships: ${membershipCount}`);
  console.log(`  tags: ${tagCount}`);
  console.log(`  notes: ${noteCount}`);
  console.log(`  note_versions: ${noteVersionCount}`);
  console.log(`  note_tags: ${noteTagCount}`);
  console.log(`  note_shares: ${noteShareCount}`);
  console.log(`  files: ${fileCount}`);
  console.log("sample logins:");
  for (const user of authUsers.slice(0, 3)) {
    console.log(`  ${user.email} / password123!`);
  }
}

async function countRows(
  db: DbClient,
  table: any,
): Promise<number> {
  const rows = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(table);
  return rows[0]?.count ?? 0;
}
