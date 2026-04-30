import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createNote,
  getNoteDetailForUser,
  listNotesForUser,
  updateNote,
  NotesError,
} from "@/lib/notes";
import { searchNotes } from "@/lib/search";
import type { AgentPrincipal } from "@/lib/agent";
import { withAudit } from "./audit";
import { errorToolResult, textToolResult } from "./format";

const VISIBILITY = ["private", "org", "shared"] as const;

/**
 * Map a thrown NotesError to an MCP error result so the model gets a clean
 * "FORBIDDEN: ..." string instead of a JSON-RPC -32000 with a stack trace.
 */
function handleNotesError(err: unknown) {
  if (err instanceof NotesError) {
    return errorToolResult(`${err.code}: ${err.message}`);
  }
  throw err;
}

export function registerTools(server: McpServer, principal: AgentPrincipal): void {
  // -------------------------------------------------------------------------
  // whoami — confirms the bound principal. Useful as a sanity-check tool the
  // model can call once at the start of a conversation.
  // -------------------------------------------------------------------------
  server.registerTool(
    "whoami",
    {
      title: "Identify the bound MCP principal",
      description:
        "Returns the org_id and user_id this MCP session is acting on behalf of. " +
        "All other tools are scoped to this org.",
      inputSchema: {},
    },
    async () =>
      withAudit({
        principal,
        kind: "tool",
        name: "whoami",
        run: async () =>
          textToolResult({
            orgId: principal.orgId,
            userId: principal.userId,
          }),
      }),
  );

  // -------------------------------------------------------------------------
  // search_notes — full-text + filter search. Reuses src/lib/search/service.ts.
  // -------------------------------------------------------------------------
  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Full-text + tag/author/date search across the org's notes. " +
        "Returns ranked results with snippets. Use for 'what did I write about X' questions.",
      inputSchema: {
        q: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .optional()
          .describe("Free-text query. Optional — filters alone are valid."),
        tag: z.string().trim().min(1).max(64).optional(),
        authorId: z.string().uuid().optional(),
        visibility: z.enum(["all", ...VISIBILITY]).default("all"),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO date YYYY-MM-DD. Updated-at lower bound."),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO date YYYY-MM-DD. Updated-at upper bound."),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(50).default(20),
      },
    },
    async (args) =>
      withAudit({
        principal,
        kind: "tool",
        name: "search_notes",
        meta: { hasQuery: Boolean(args.q), pageSize: args.pageSize },
        run: async () => {
          try {
            const response = await searchNotes(
              { ...args, orgId: principal.orgId },
              { orgId: principal.orgId, userId: principal.userId },
            );
            return textToolResult({
              page: response.page,
              pageSize: response.pageSize,
              hasNextPage: response.hasNextPage,
              count: response.results.length,
              results: response.results,
            });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // list_recent_notes — paginated recency view. Useful for "what's new".
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_recent_notes",
    {
      title: "List recent notes",
      description:
        "List notes in the principal's org sorted by most-recently-updated. " +
        "Filterable by tag/author/visibility. Cursor-paginated.",
      inputSchema: {
        tag: z.string().trim().min(1).max(64).optional(),
        authorId: z.string().uuid().optional(),
        visibility: z.enum(VISIBILITY).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    async (args) =>
      withAudit({
        principal,
        kind: "tool",
        name: "list_recent_notes",
        meta: { limit: args.limit },
        run: async () => {
          try {
            const result = await listNotesForUser(
              { ...args, orgId: principal.orgId },
              principal.userId,
            );
            return textToolResult({
              count: result.notes.length,
              nextCursor: result.nextCursor,
              notes: result.notes.map((n) => ({
                id: n.id,
                title: n.title,
                excerpt: n.excerpt,
                visibility: n.visibility,
                updatedAt: n.updatedAt,
                author: n.author,
                tags: n.tags,
              })),
            });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // get_note — full content + metadata for a single note.
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_note",
    {
      title: "Get a note",
      description:
        "Fetch a note's full content, metadata, share list, and version history. " +
        "Permission is checked against the bound principal.",
      inputSchema: {
        noteId: z.string().uuid(),
      },
    },
    async ({ noteId }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "get_note",
        meta: { noteId },
        run: async () => {
          try {
            const { note } = await getNoteDetailForUser(noteId, principal.userId);
            return textToolResult({
              id: note.id,
              title: note.title,
              content: note.content,
              visibility: note.visibility,
              currentVersion: note.currentVersion,
              author: note.author,
              tags: note.tags,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              history: note.history,
              shares: note.shares.map((s) => ({
                userId: s.sharedWith.id,
                permission: s.permission,
              })),
            });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // update_note — append a new version to an existing note.
  // -------------------------------------------------------------------------
  server.registerTool(
    "update_note",
    {
      title: "Update a note (new version)",
      description:
        "Append a new version to an existing note. " +
        "All fields are optional — omitted fields keep their current value. " +
        "Use this to evolve a session note in place rather than creating new notes. " +
        "Every call increments currentVersion and records a snapshot in version history. " +
        "Permission is checked: you must be able to write to this note.",
      inputSchema: {
        noteId: z.string().uuid().describe("ID of the note to update."),
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().max(100_000).optional(),
        visibility: z.enum(VISIBILITY).optional(),
        tags: z
          .array(z.string().trim().min(1).max(64))
          .max(20)
          .optional()
          .describe("Replaces the full tag list. Omit to keep existing tags."),
        changeSummary: z
          .string()
          .trim()
          .max(280)
          .optional()
          .describe("Short description of what changed (shown in version history)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ noteId, ...rest }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "update_note",
        meta: { noteId, contentLength: rest.content?.length },
        run: async () => {
          try {
            const note = await updateNote(noteId, rest, principal.userId);
            return textToolResult({
              id: note.id,
              title: note.title,
              currentVersion: note.currentVersion,
              visibility: note.visibility,
              updatedAt: note.updatedAt,
            });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // create_note — write a new note as the principal.
  // -------------------------------------------------------------------------
  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Create a new note in the bound org, authored by the bound principal. " +
        "Content is markdown. Returns the new note's id.",
      inputSchema: {
        title: z.string().trim().min(1).max(200),
        content: z.string().max(100_000).default(""),
        visibility: z.enum(VISIBILITY).default("org"),
        tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
        changeSummary: z.string().trim().max(280).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args) =>
      withAudit({
        principal,
        kind: "tool",
        name: "create_note",
        meta: { titleLength: args.title.length, contentLength: args.content.length },
        run: async () => {
          try {
            const note = await createNote(
              { ...args, orgId: principal.orgId },
              principal.userId,
            );
            return textToolResult({
              id: note.id,
              title: note.title,
              visibility: note.visibility,
              currentVersion: note.currentVersion,
              createdAt: note.createdAt,
            });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );
}
