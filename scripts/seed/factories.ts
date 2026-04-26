/**
 * Type-safe factories for seed data. Owned by the `seed-10k` module agent
 * for content shape; baseline ships only the skeleton + a deterministic faker
 * seed so reruns produce the same data.
 *
 * Module agent: fill in realistic content distributions for each factory.
 * Aim for: overlapping tag names across orgs, notes with 1–5 tags each,
 * a mix of 'private'/'org'/'shared' visibility (~10/70/20), 1–5 versions
 * per note, ~5% of notes with one or more file attachments.
 */
import { faker } from "@faker-js/faker";
import type {
  NoteVisibility,
  OrgRole,
  SharePermission,
} from "@/lib/db/schema";

/**
 * Deterministic seed — same SEED env produces same data. Useful for
 * reproducible review.
 */
export function setFakerSeed(seed = 42) {
  faker.seed(seed);
}

export interface OrgInput {
  name: string;
  slug: string;
}

export interface UserInput {
  email: string;
  password: string;
  displayName: string;
}

export interface MembershipInput {
  orgIdx: number;
  userIdx: number;
  role: OrgRole;
}

export interface NoteInput {
  orgIdx: number;
  authorIdx: number;
  title: string;
  content: string;
  visibility: NoteVisibility;
  tagNames: string[];
  versions: VersionInput[];
}

export interface VersionInput {
  title: string;
  content: string;
  authorIdx: number;
  changeSummary?: string;
}

export interface ShareInput {
  noteIdx: number;
  withUserIdx: number;
  permission: SharePermission;
}

export interface FileInput {
  orgIdx: number;
  noteIdx?: number;
  uploaderIdx: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Skeleton generators — module agent replaces with realistic versions.
// ---------------------------------------------------------------------------

export function makeOrg(): OrgInput {
  const name = faker.company.name();
  return { name, slug: faker.helpers.slugify(name).toLowerCase() };
}

export function makeUser(): UserInput {
  return {
    email: faker.internet.email().toLowerCase(),
    password: "password123!",
    displayName: faker.person.fullName(),
  };
}

export function makeNoteTitle(): string {
  return faker.lorem.sentence({ min: 3, max: 8 }).replace(/\.$/, "");
}

export function makeNoteBody(): string {
  return faker.lorem.paragraphs({ min: 1, max: 4 }, "\n\n");
}
