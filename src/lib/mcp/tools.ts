import { z } from "zod";
import { and, count, eq, isNull, ilike } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createNote,
  getNoteDetailForUser,
  getNoteVersionsForUser,
  listNotesForUser,
  updateNote,
  NotesError,
} from "@/lib/notes";
import { searchNotes } from "@/lib/search";
import { getOrgTimeline } from "@/lib/timeline/queries";
import { listAgentSessions } from "@/lib/agent/queries";
import { db } from "@/lib/db/client";
import { notes, tags, noteTags } from "@/lib/db/schema";
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
        "Provide either noteId (UUID) or title (exact match within the org). " +
        "Permission is checked against the bound principal.",
      inputSchema: {
        noteId: z.string().uuid().optional().describe("Note UUID. Takes precedence over title."),
        title: z.string().trim().min(1).max(200).optional().describe("Exact note title. Used when noteId is not known."),
      },
    },
    async ({ noteId, title }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "get_note",
        meta: { noteId, title },
        run: async () => {
          try {
            let resolvedId = noteId;
            if (!resolvedId) {
              if (!title) return errorToolResult("Provide either noteId or title.");
              const [row] = await db
                .select({ id: notes.id })
                .from(notes)
                .where(
                  and(
                    eq(notes.orgId, principal.orgId),
                    ilike(notes.title, title),
                    isNull(notes.deletedAt),
                  ),
                )
                .limit(1);
              if (!row) return errorToolResult(`NOT_FOUND: No note titled "${title}".`);
              resolvedId = row.id;
            }
            const { note } = await getNoteDetailForUser(resolvedId, principal.userId);
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

  // -------------------------------------------------------------------------
  // append_to_note — add content to the end of an existing note safely.
  // -------------------------------------------------------------------------
  server.registerTool(
    "append_to_note",
    {
      title: "Append to a note",
      description:
        "Safely append content to an existing note without overwriting it. " +
        "Reads the current content, appends a separator + new content, and writes a new version. " +
        "Preferred over update_note for shared or concurrent writes.",
      inputSchema: {
        noteId: z.string().uuid(),
        content: z.string().min(1).max(50_000).describe("Markdown content to append."),
        changeSummary: z.string().trim().max(280).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ noteId, content, changeSummary }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "append_to_note",
        meta: { noteId, appendLength: content.length },
        run: async () => {
          try {
            const { note } = await getNoteDetailForUser(noteId, principal.userId);
            const updated = await updateNote(
              noteId,
              {
                content: note.content ? `${note.content}\n\n${content}` : content,
                changeSummary: changeSummary ?? "append",
              },
              principal.userId,
            );
            return textToolResult({
              id: updated.id,
              title: updated.title,
              currentVersion: updated.currentVersion,
              updatedAt: updated.updatedAt,
            });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // get_note_versions — full version history with content snapshots.
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_note_versions",
    {
      title: "Get note version history",
      description:
        "Returns all version snapshots for a note — content, changeSummary, and timestamp for each. " +
        "Useful for tracking how a memory entry evolved over time.",
      inputSchema: {
        noteId: z.string().uuid(),
      },
    },
    async ({ noteId }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "get_note_versions",
        meta: { noteId },
        run: async () => {
          try {
            const { versions } = await getNoteVersionsForUser(noteId, principal.userId);
            return textToolResult({ noteId, count: versions.length, versions });
          } catch (err) {
            return handleNotesError(err);
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // list_tags — all tags used in this org with note counts.
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_tags",
    {
      title: "List org tags",
      description:
        "Returns all tags used in this org, each with the number of notes tagged. " +
        "Use to discover available categories before filtering with search_notes or list_recent_notes.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(100),
      },
    },
    async ({ limit }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "list_tags",
        meta: { limit },
        run: async () => {
          const rows = await db
            .select({
              name: tags.name,
              noteCount: count(noteTags.noteId),
            })
            .from(tags)
            .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
            .where(eq(tags.orgId, principal.orgId))
            .groupBy(tags.id, tags.name)
            .orderBy(tags.name)
            .limit(limit);
          return textToolResult({ count: rows.length, tags: rows });
        },
      }),
  );

  // -------------------------------------------------------------------------
  // list_agent_sessions — active/recent agent sessions in this org.
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_agent_sessions",
    {
      title: "List agent sessions",
      description:
        "Returns recent agent sessions in this org — agentId, repo, branch, session note id, and last-seen timestamp. " +
        "Useful for multi-agent coordination: see what other agents are working on, then use get_note to read their session note.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ limit }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "list_agent_sessions",
        meta: { limit },
        run: async () => {
          const sessions = await listAgentSessions(principal.orgId, limit);
          return textToolResult({ count: sessions.length, sessions });
        },
      }),
  );

  // -------------------------------------------------------------------------
  // log_turn — log a summary of this assistant response as a conversation turn.
  // -------------------------------------------------------------------------
  server.registerTool(
    "log_turn",
    {
      title: "Log assistant turn summary",
      description:
        "Log a summary of this assistant response as a conversation turn. " +
        "Call at the end of each significant response. Include what you did and which notes were created or updated. " +
        "sessionNoteId is available in your bootstrap context.",
      inputSchema: {
        sessionNoteId: z.string().uuid().describe("The session note ID from your bootstrap context."),
        summary: z.string().min(1).max(5_000),
        noteRefs: z
          .array(
            z.object({
              noteId: z.string().uuid(),
              version: z.number().int().optional(),
              title: z.string().max(200).optional(),
            }),
          )
          .max(20)
          .default([]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ sessionNoteId, summary, noteRefs }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "log_turn",
        meta: { sessionNoteId, summaryLength: summary.length, noteRefCount: noteRefs.length },
        run: async () => {
          try {
            const { addTurn } = await import("@/lib/agent/conversation");
            const result = await addTurn({
              orgId: principal.orgId,
              sessionNoteId,
              role: "assistant",
              content: summary,
              noteRefs,
            });
            return textToolResult({ turnIndex: result.turnIndex });
          } catch (err) {
            return errorToolResult(err instanceof Error ? err.message : "Failed to log turn");
          }
        },
      }),
  );

  // -------------------------------------------------------------------------
  // get_conversation — retrieve conversation turns and auto-summaries.
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_conversation",
    {
      title: "Get conversation history",
      description:
        "Retrieve conversation turns and auto-summaries for a session note. " +
        "Shows the log of user prompts and assistant summaries with note refs.",
      inputSchema: {
        sessionNoteId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ sessionNoteId, limit }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "get_conversation",
        meta: { sessionNoteId, limit },
        run: async () => {
          const { getConversation } = await import("@/lib/agent/conversation");
          const data = await getConversation(sessionNoteId, limit);
          return textToolResult(data);
        },
      }),
  );

  // -------------------------------------------------------------------------
  // get_org_timeline — recent audit events across the whole org.
  // -------------------------------------------------------------------------
  server.registerTool(
    "get_org_timeline",
    {
      title: "Get org timeline",
      description:
        "Returns recent audit events across the whole org — note edits, AI summaries, agent checkpoints, search queries, and more. " +
        "Useful for situational awareness: 'what happened in this org recently?'",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(50),
      },
    },
    async ({ limit }) =>
      withAudit({
        principal,
        kind: "tool",
        name: "get_org_timeline",
        meta: { limit },
        run: async () => {
          const events = await getOrgTimeline(principal.orgId, limit);
          return textToolResult({
            count: events.length,
            events: events.map((e) => ({
              id: e.id,
              action: e.action,
              noteId: e.noteId,
              noteTitle: e.noteTitle,
              actor: e.actor,
              metadata: e.metadata,
              createdAt: e.createdAt,
            })),
          });
        },
      }),
  );
}
