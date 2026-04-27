/**
 * Type-safe factories for seed data. Owned by the `seed-10k` module agent
 * for content shape; baseline ships only the skeleton + a deterministic faker
 * seed so reruns produce the same data.
 *
 * Module agent: fill in realistic content distributions for each factory.
 * Aim for: overlapping tag names across orgs, notes with 1–5 tags each,
 * a mix of 'private'/'org'/'shared' visibility (~10/70/20), 1–5 versions
 * per note, and a small fixed-size file set sized for the large seed run.
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
  body: Buffer;
}

export interface TagInput {
  orgIdx: number;
  name: string;
}

export interface SeedPlan {
  orgs: OrgInput[];
  users: UserInput[];
  memberships: MembershipInput[];
  tags: TagInput[];
  notes: NoteInput[];
  shares: ShareInput[];
  files: FileInput[];
}

export const SEED_EMAIL_PREFIX = "seed-user";
export const SEED_EMAIL_DOMAIN = "notes-app.local";
export const SEED_ORG_SLUG_PREFIX = "seed-org";
export const SEED_STORAGE_BUCKET = "notes-files";

const ORG_THEMES = [
  "Product",
  "Engineering",
  "Design",
  "Operations",
  "Support",
  "Finance",
  "Marketing",
  "Research",
];

const SHARED_TAG_POOL = [
  "todo",
  "meeting",
  "roadmap",
  "planning",
  "customer",
  "launch",
  "incident",
  "retro",
  "qa",
  "metrics",
  "compliance",
  "handoff",
  "automation",
  "docs",
  "follow-up",
  "ops",
  "priority",
  "beta",
];

const REQUIRED_OVERLAP_TAGS = ["roadmap", "todo", "meeting", "retro", "customer"];

const ORG_SPECIFIC_TAGS = [
  ["backlog", "sprint", "release", "discovery"],
  ["infra", "api", "observability", "performance"],
  ["ux", "research", "copy", "prototype"],
  ["runbook", "oncall", "vendor", "process"],
  ["inbox", "triage", "sla", "escalation"],
  ["budget", "forecast", "renewal", "expense"],
  ["campaign", "seo", "content", "attribution"],
  ["findings", "experiment", "dataset", "analysis"],
];

const NOTE_SUBJECTS = [
  "weekly sync",
  "project brief",
  "launch checklist",
  "customer follow-up",
  "migration plan",
  "incident review",
  "feature request",
  "integration notes",
  "retrospective",
  "handoff memo",
];

const TITLE_QUALIFIERS = [
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "Sprint",
  "Partner",
  "Internal",
  "Customer",
];

const CHANGE_SUMMARIES = [
  "Expanded scope and clarified next steps",
  "Added action items from stakeholder review",
  "Updated status after async feedback",
  "Tightened language and captured open questions",
  "Added supporting detail from the latest thread",
];

const FILE_TEMPLATES = [
  { extension: "pdf", mimeType: "application/pdf" },
  { extension: "png", mimeType: "image/png" },
  { extension: "txt", mimeType: "text/plain" },
  { extension: "md", mimeType: "text/markdown" },
];

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

export function buildSeedPlan(input: {
  noteCount: number;
  orgCount: number;
  userCount: number;
}): SeedPlan {
  const orgs = Array.from({ length: input.orgCount }, (_, orgIdx) =>
    makeSeedOrg(orgIdx),
  );
  const users = Array.from({ length: input.userCount }, (_, userIdx) =>
    makeSeedUser(userIdx),
  );

  const memberships = buildMemberships(input.orgCount, input.userCount);
  const membershipsByOrg = groupMembershipsByOrg(memberships, input.orgCount);
  const tags = buildTags(orgs, input.orgCount);
  const tagsByOrg = groupTagsByOrg(tags, input.orgCount);

  const notes: NoteInput[] = [];
  const shares: ShareInput[] = [];
  const notesPerOrg = distributeWeightedCount(
    input.noteCount,
    membershipsByOrg.map((members) => members.length),
  );

  for (let orgIdx = 0; orgIdx < input.orgCount; orgIdx += 1) {
    const memberRows = membershipsByOrg[orgIdx] ?? [];
    const writerRows = memberRows.filter((row) => row.role !== "viewer");
    const shareableUsers = memberRows.map((row) => row.userIdx);
    const tagNames = (tagsByOrg[orgIdx] ?? []).map((row) => row.name);

    for (let localIdx = 0; localIdx < notesPerOrg[orgIdx]; localIdx += 1) {
      const author = faker.helpers.arrayElement(
        writerRows.length > 0 ? writerRows : memberRows,
      );
      const visibility = chooseVisibility();
      const versionCount = chooseVersionCount();
      const title = makeSeedNoteTitle(orgIdx, localIdx);
      const content = makeStructuredBody({
        title,
        orgName: orgs[orgIdx].name,
        versionNumber: versionCount,
      });
      const versions = buildVersions({
        authorIdx: author?.userIdx ?? 0,
        baseContent: content,
        baseTitle: title,
        orgName: orgs[orgIdx].name,
        versionCount,
      });
      const latestVersion = versions[versions.length - 1];
      const noteIdx = notes.length;
      const resolvedVisibility =
        visibility === "shared" && shareableUsers.length < 2 ? "org" : visibility;

      notes.push({
        orgIdx,
        authorIdx: author?.userIdx ?? 0,
        title: latestVersion.title,
        content: latestVersion.content,
        visibility: resolvedVisibility,
        tagNames: chooseTagNames(tagNames),
        versions: versions.map((version) => ({
          ...version,
          title: version.title,
          content: version.content,
        })),
      });

      if (resolvedVisibility === "shared") {
        shares.push(
          ...buildShares({
            authorIdx: author?.userIdx ?? 0,
            memberUserIdxs: shareableUsers,
            noteIdx,
          }),
        );
      }
    }
  }

  const files = buildFiles({
    membershipsByOrg,
    noteCount: input.noteCount,
    notes,
  });

  return { orgs, users, memberships, tags, notes, shares, files };
}

function makeSeedOrg(orgIdx: number): OrgInput {
  const theme = ORG_THEMES[orgIdx % ORG_THEMES.length];
  const name = `${faker.company.name()} ${theme}`;
  return {
    name,
    slug: `${SEED_ORG_SLUG_PREFIX}-${String(orgIdx + 1).padStart(2, "0")}`,
  };
}

function makeSeedUser(userIdx: number): UserInput {
  return {
    email: `${SEED_EMAIL_PREFIX}-${String(userIdx + 1).padStart(4, "0")}@${SEED_EMAIL_DOMAIN}`,
    password: "password123!",
    displayName: faker.person.fullName(),
  };
}

function buildMemberships(orgCount: number, userCount: number): MembershipInput[] {
  if (orgCount === 0 || userCount === 0) return [];

  const membershipsByUser = Array.from({ length: userCount }, () => new Set<number>());
  const universalUserCount = Math.min(3, userCount);
  const ownerByOrg = Array.from({ length: orgCount }, (_, orgIdx) => orgIdx % userCount);
  const minMembersPerOrg = Math.min(userCount, Math.max(4, Math.ceil(userCount / orgCount) + 1));

  for (let userIdx = 0; userIdx < universalUserCount; userIdx += 1) {
    for (let orgIdx = 0; orgIdx < orgCount; orgIdx += 1) {
      membershipsByUser[userIdx].add(orgIdx);
    }
  }

  for (let orgIdx = 0; orgIdx < orgCount; orgIdx += 1) {
    membershipsByUser[ownerByOrg[orgIdx]].add(orgIdx);
  }

  for (let userIdx = universalUserCount; userIdx < userCount; userIdx += 1) {
    const targetCount = faker.number.int({ min: 1, max: 100 }) <= 70 ? 1 : 2;
    const availableOrgs = faker.helpers.shuffle(
      Array.from({ length: orgCount }, (_, orgIdx) => orgIdx).filter(
        (orgIdx) => !membershipsByUser[userIdx].has(orgIdx),
      ),
    );

    while (membershipsByUser[userIdx].size < targetCount && availableOrgs.length > 0) {
      const nextOrg = availableOrgs.shift();
      if (typeof nextOrg === "number") {
        membershipsByUser[userIdx].add(nextOrg);
      }
    }
  }

  const membershipsByOrg = Array.from({ length: orgCount }, () => new Set<number>());
  for (let userIdx = 0; userIdx < userCount; userIdx += 1) {
    for (const orgIdx of membershipsByUser[userIdx]) {
      membershipsByOrg[orgIdx].add(userIdx);
    }
  }

  for (let orgIdx = 0; orgIdx < orgCount; orgIdx += 1) {
    while (membershipsByOrg[orgIdx].size < minMembersPerOrg) {
      const candidates = Array.from({ length: userCount }, (_, userIdx) => userIdx)
        .filter((userIdx) => !membershipsByOrg[orgIdx].has(userIdx))
        .sort((left, right) => membershipsByUser[left].size - membershipsByUser[right].size);
      const chosenUserIdx = candidates[0];
      if (typeof chosenUserIdx !== "number") break;
      membershipsByOrg[orgIdx].add(chosenUserIdx);
      membershipsByUser[chosenUserIdx].add(orgIdx);
    }
  }

  const memberships: MembershipInput[] = [];

  for (let orgIdx = 0; orgIdx < orgCount; orgIdx += 1) {
    const ownerIdx = ownerByOrg[orgIdx];
    const members = Array.from(membershipsByOrg[orgIdx]).sort((left, right) => left - right);
    const adminTarget = members.length >= 6 ? 2 : 1;
    const adminCandidates = faker.helpers.shuffle(
      members.filter((userIdx) => userIdx !== ownerIdx),
    );
    const adminSet = new Set(adminCandidates.slice(0, adminTarget));
    const viewerCandidates = faker.helpers.shuffle(
      members.filter((userIdx) => userIdx !== ownerIdx && !adminSet.has(userIdx)),
    );
    const viewerSet = new Set(
      members.length >= 5 ? viewerCandidates.slice(0, 1) : [],
    );

    for (const userIdx of members) {
      let role: OrgRole = "member";
      if (userIdx === ownerIdx) {
        role = "owner";
      } else if (adminSet.has(userIdx)) {
        role = "admin";
      } else if (viewerSet.has(userIdx)) {
        role = "viewer";
      }

      memberships.push({ orgIdx, userIdx, role });
    }
  }

  return memberships;
}

function buildTags(orgs: OrgInput[], orgCount: number): TagInput[] {
  const tags: TagInput[] = [];

  for (let orgIdx = 0; orgIdx < orgCount; orgIdx += 1) {
    const sharedTags = faker.helpers.arrayElements(SHARED_TAG_POOL, 8);
    const orgTags = ORG_SPECIFIC_TAGS[orgIdx % ORG_SPECIFIC_TAGS.length];
    const nameSet = new Set([
      ...REQUIRED_OVERLAP_TAGS,
      ...sharedTags,
      ...orgTags,
      faker.helpers.slugify(orgs[orgIdx].name.split(" ")[0]).toLowerCase(),
      faker.helpers.slugify(orgs[orgIdx].name.split(" ").slice(-1)[0] ?? "team").toLowerCase(),
      `${ORG_THEMES[orgIdx % ORG_THEMES.length].toLowerCase()}-review`,
      `${ORG_THEMES[orgIdx % ORG_THEMES.length].toLowerCase()}-ops`,
    ]);

    for (const name of nameSet) {
      tags.push({ orgIdx, name });
    }
  }

  return tags;
}

function makeSeedNoteTitle(_orgIdx: number, noteIdx: number): string {
  const subject = NOTE_SUBJECTS[noteIdx % NOTE_SUBJECTS.length];
  const qualifier =
    TITLE_QUALIFIERS[Math.floor(noteIdx / NOTE_SUBJECTS.length) % TITLE_QUALIFIERS.length];

  return `${toTitleCase(subject)} ${qualifier}`;
}

function chooseVisibility(): NoteVisibility {
  const roll = faker.number.int({ min: 1, max: 100 });
  if (roll <= 10) return "private";
  if (roll <= 80) return "org";
  return "shared";
}

function chooseVersionCount(): number {
  const roll = faker.number.int({ min: 1, max: 100 });
  if (roll <= 10) return 1;
  if (roll <= 55) return 2;
  if (roll <= 85) return 3;
  if (roll <= 97) return 4;
  return 5;
}

function buildVersions(input: {
  authorIdx: number;
  baseContent: string;
  baseTitle: string;
  orgName: string;
  versionCount: number;
}): VersionInput[] {
  const versions: VersionInput[] = [];

  for (let version = 1; version <= input.versionCount; version += 1) {
    const title =
      version === input.versionCount
        ? input.baseTitle
        : `${input.baseTitle} draft ${version}`;
    const content =
      version === input.versionCount
        ? input.baseContent
        : makeStructuredBody({
            title,
            orgName: input.orgName,
            versionNumber: version,
          });

    versions.push({
      title,
      content,
      authorIdx: input.authorIdx,
      changeSummary:
        version === 1
          ? undefined
          : CHANGE_SUMMARIES[(version - 2) % CHANGE_SUMMARIES.length],
    });
  }

  return versions;
}

function makeStructuredBody(input: {
  title: string;
  orgName: string;
  versionNumber: number;
}): string {
  const bullets = faker.helpers.arrayElements(
    [
      "Confirm ownership before execution",
      "Capture open questions in the follow-up thread",
      "Review metrics after rollout",
      "Share the latest draft with stakeholders",
      "Document edge cases for support",
      "Close the loop with implementation notes",
    ],
    3,
  );

  const checklist = faker.helpers.arrayElements(
    [
      "[ ] Validate the current assumptions",
      "[ ] Confirm staffing and timeline",
      "[ ] Publish the summary in the team channel",
      "[ ] Track decisions in the roadmap",
      "[ ] Add a short retro item",
    ],
    2,
  );

  return [
    `# ${input.title}`,
    "",
    `Version ${input.versionNumber} for ${input.orgName}.`,
    "",
    "## Context",
    faker.lorem.paragraph({ min: 2, max: 4 }),
    "",
    "## Decisions",
    ...bullets.map((bullet) => `- ${bullet}`),
    "",
    "## Next",
    ...checklist,
  ].join("\n");
}

function chooseTagNames(tagNames: string[]): string[] {
  if (tagNames.length === 0) return [];
  const count = Math.min(
    tagNames.length,
    faker.number.int({ min: 1, max: Math.min(5, tagNames.length) }),
  );
  return faker.helpers.arrayElements(tagNames, count);
}

function buildShares(input: {
  authorIdx: number;
  memberUserIdxs: number[];
  noteIdx: number;
}): ShareInput[] {
  const recipients = input.memberUserIdxs.filter(
    (userIdx) => userIdx !== input.authorIdx,
  );
  if (recipients.length === 0) return [];

  const shareCount = Math.min(
    recipients.length,
    faker.number.int({ min: 1, max: Math.min(3, recipients.length) }),
  );

  return faker.helpers.arrayElements(recipients, shareCount).map((withUserIdx) => ({
    noteIdx: input.noteIdx,
    withUserIdx,
    permission: chooseSharePermission(),
  }));
}

function chooseSharePermission(): SharePermission {
  return faker.number.int({ min: 1, max: 100 }) <= 25 ? "edit" : "view";
}

function buildFiles(input: {
  membershipsByOrg: Array<MembershipInput[]>;
  noteCount: number;
  notes: NoteInput[];
}): FileInput[] {
  const files: FileInput[] = [];
  const targetFileCount = Math.max(12, Math.round(input.noteCount / 100));
  const attachedFileCount = Math.min(
    input.notes.length,
    Math.round(targetFileCount * 0.8),
  );
  const orgLevelFileCount = Math.max(0, targetFileCount - attachedFileCount);
  const chosenNoteIdxs = faker.helpers
    .shuffle(Array.from({ length: input.notes.length }, (_, noteIdx) => noteIdx))
    .slice(0, attachedFileCount);
  const orgFileOrgIdxs = distributeWeightedSequence(
    orgLevelFileCount,
    input.membershipsByOrg.map((members) => members.length),
  );

  chosenNoteIdxs.forEach((noteIdx, attachmentIdx) => {
    const note = input.notes[noteIdx];
    const file = makeFileRecord({
      attachmentIdx,
      noteIdx,
      orgIdx: note.orgIdx,
      title: note.title,
      uploaderIdx: note.authorIdx,
    });
    files.push(file);
  });

  orgFileOrgIdxs.forEach((orgIdx, attachmentIdx) => {
    const members = input.membershipsByOrg[orgIdx] ?? [];
    const writers = members.filter((member) => member.role !== "viewer");
    const uploader =
      faker.helpers.arrayElement(writers.length > 0 ? writers : members) ??
      members[0];
    if (!uploader) return;

    const file = makeFileRecord({
      attachmentIdx: attachedFileCount + attachmentIdx,
      orgIdx,
      title: `${ORG_THEMES[orgIdx % ORG_THEMES.length]} org packet`,
      uploaderIdx: uploader.userIdx,
    });
    files.push(file);
  });

  return files;
}

function makeFileRecord(input: {
  attachmentIdx: number;
  noteIdx?: number;
  orgIdx: number;
  title: string;
  uploaderIdx: number;
}): FileInput {
  const template = FILE_TEMPLATES[input.attachmentIdx % FILE_TEMPLATES.length];
  const slug = faker.helpers.slugify(input.title).toLowerCase().slice(0, 36);
  const fileName = `${slug || "note"}-${String(input.attachmentIdx + 1).padStart(3, "0")}.${template.extension}`;
  const body = makeFileBody(input.title, template.extension);

  return {
    orgIdx: input.orgIdx,
    noteIdx: input.noteIdx,
    uploaderIdx: input.uploaderIdx,
    fileName,
    mimeType: template.mimeType,
    sizeBytes: body.byteLength,
    body,
  };
}

function makeFileBody(title: string, extension: string): Buffer {
  if (extension === "pdf") {
    return Buffer.from(
      `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 /Kids [3 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 53 >>
stream
BT /F1 12 Tf 24 60 Td (${title.slice(0, 24)}) Tj ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`,
      "utf8",
    );
  }

  if (extension === "png") {
    return Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn7L9kAAAAASUVORK5CYII=",
      "base64",
    );
  }

  if (extension === "txt") {
    return Buffer.from(
      [title, faker.lorem.sentence(), faker.lorem.sentence()].join("\n"),
      "utf8",
    );
  }

  return Buffer.from(
    [`# ${title}`, "", faker.lorem.paragraphs(2, "\n\n")].join("\n"),
    "utf8",
  );
}

function groupMembershipsByOrg(
  memberships: MembershipInput[],
  orgCount: number,
): Array<MembershipInput[]> {
  const grouped = Array.from({ length: orgCount }, () => [] as MembershipInput[]);
  for (const membership of memberships) {
    grouped[membership.orgIdx].push(membership);
  }
  return grouped;
}

function groupTagsByOrg(tags: TagInput[], orgCount: number): Array<TagInput[]> {
  const grouped = Array.from({ length: orgCount }, () => [] as TagInput[]);
  for (const tag of tags) {
    grouped[tag.orgIdx].push(tag);
  }
  return grouped;
}

function distributeWeightedCount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const safeWeights = weights.some((weight) => weight > 0)
    ? weights
    : weights.map(() => 1);
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const rawCounts = safeWeights.map((weight) => (total * weight) / weightTotal);
  const counts = rawCounts.map((count) => Math.floor(count));
  let remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const remainders = rawCounts
    .map((count, idx) => ({ idx, remainder: count - counts[idx] }))
    .sort((left, right) => right.remainder - left.remainder);

  for (const entry of remainders) {
    if (remaining <= 0) break;
    counts[entry.idx] += 1;
    remaining -= 1;
  }

  return counts;
}

function distributeWeightedSequence(total: number, weights: number[]): number[] {
  return distributeWeightedCount(total, weights).flatMap((count, idx) =>
    Array.from({ length: count }, () => idx),
  );
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
