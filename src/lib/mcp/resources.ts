import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getNoteDetailForUser,
  listNotesForUser,
  NotesError,
} from "@/lib/notes";
import type { AgentPrincipal } from "@/lib/agent";
import { withAudit } from "./audit";
import { jsonResource } from "./format";

/**
 * MCP resources — addressable, browseable read-only views of the notes app.
 * Resources are how MCP clients (and the model) discover content without
 * needing to call a tool. Two registered:
 *
 *   notes://recent          → list of 50 most-recently-updated notes
 *   notes://note/{noteId}   → single note's content (template)
 *
 * Both go through the same permission checks the web UI uses, scoped to the
 * bound principal.
 */
export function registerResources(
  server: McpServer,
  principal: AgentPrincipal,
): void {
  // -------------------------------------------------------------------------
  // notes://recent — static resource, list view
  // -------------------------------------------------------------------------
  server.registerResource(
    "recent_notes",
    "notes://recent",
    {
      title: "Recent notes",
      description:
        "The 50 most-recently-updated notes the bound principal can see.",
      mimeType: "application/json",
    },
    async (uri) =>
      withAudit({
        principal,
        kind: "resource",
        name: "notes://recent",
        run: async () => {
          const result = await listNotesForUser(
            { orgId: principal.orgId, limit: 50 },
            principal.userId,
          );
          return jsonResource(uri.href, {
            count: result.notes.length,
            notes: result.notes.map((n) => ({
              uri: `notes://note/${n.id}`,
              id: n.id,
              title: n.title,
              excerpt: n.excerpt,
              visibility: n.visibility,
              updatedAt: n.updatedAt,
              tags: n.tags,
            })),
          });
        },
      }),
  );

  // -------------------------------------------------------------------------
  // notes://note/{noteId} — template resource, single note
  // -------------------------------------------------------------------------
  server.registerResource(
    "note",
    new ResourceTemplate("notes://note/{noteId}", {
      list: async () => {
        const result = await listNotesForUser(
          { orgId: principal.orgId, limit: 100 },
          principal.userId,
        );
        return {
          resources: result.notes.map((n) => ({
            uri: `notes://note/${n.id}`,
            name: `note:${n.id.slice(0, 8)}`,
            title: n.title,
            description: n.excerpt,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Note",
      description:
        "Fetch the full content, history, and metadata for a single note.",
      mimeType: "application/json",
    },
    async (uri, { noteId }) =>
      withAudit({
        principal,
        kind: "resource",
        name: "notes://note/{noteId}",
        meta: { noteId: String(noteId) },
        run: async () => {
          try {
            const { note } = await getNoteDetailForUser(
              String(noteId),
              principal.userId,
            );
            return jsonResource(uri.href, {
              id: note.id,
              title: note.title,
              content: note.content,
              visibility: note.visibility,
              currentVersion: note.currentVersion,
              author: note.author,
              tags: note.tags,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
            });
          } catch (err) {
            // Resources have no isError flag; surface as JSON with an error key.
            // The model will see the structured error and can recover.
            if (err instanceof NotesError) {
              return jsonResource(uri.href, {
                error: err.code,
                message: err.message,
              });
            }
            throw err;
          }
        },
      }),
  );
}
