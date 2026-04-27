"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NoteListItem } from "@/lib/notes";
import { EmptyState, VisibilityBadge, formatTimestamp } from "../components";

interface Props {
  orgId: string;
  initialNotes: NoteListItem[];
  initialNextCursor: string | null;
  // Filters in effect — passed through to /api/notes for subsequent pages
  query: {
    q?: string;
    visibility?: string;
    authorId?: string;
    tag?: string;
  };
}

interface ApiResponse {
  ok: boolean;
  data?: { notes: NoteListItem[]; nextCursor: string | null };
  message?: string;
}

export function NotesList({ orgId, initialNotes, initialNextCursor, query }: Props) {
  const [notes, setNotes] = useState<NoteListItem[]>(initialNotes);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ orgId, cursor: nextCursor, limit: "25" });
    if (query.q) params.set("q", query.q);
    if (query.visibility) params.set("visibility", query.visibility);
    if (query.authorId) params.set("authorId", query.authorId);
    if (query.tag) params.set("tag", query.tag);

    const res = await fetch(`/api/notes?${params.toString()}`, { cache: "no-store" });
    const payload = (await res.json()) as ApiResponse;

    setLoading(false);
    if (!payload.ok || !payload.data) {
      setError(payload.message ?? "Failed to load more notes");
      return;
    }

    setNotes((prev) => [...prev, ...payload.data!.notes]);
    setNextCursor(payload.data.nextCursor);
  }

  if (notes.length === 0) {
    return (
      <EmptyState
        title="No matching notes"
        description="Try widening the filters, or create the first note if your role allows it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {notes.map((note) => (
          <Card key={note.id} className="transition hover:border-foreground/20">
            <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-xl">
                    <Link href={`/orgs/${orgId}/notes/${note.id}`} className="hover:underline">
                      {note.title}
                    </Link>
                  </CardTitle>
                  <VisibilityBadge visibility={note.visibility} />
                </div>
                <CardDescription>
                  {note.author.displayName ?? note.author.email} · updated{" "}
                  {formatTimestamp(note.updatedAt)}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/orgs/${orgId}/notes/${note.id}`}>Open</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/orgs/${orgId}/notes/${note.id}/history`}>History</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{note.excerpt || "No content yet."}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>v{note.currentVersion}</span>
                <span>·</span>
                <span>
                  {note.shareCount} share{note.shareCount === 1 ? "" : "s"}
                </span>
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2 py-1 font-medium text-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {nextCursor ? (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">All notes loaded.</p>
      )}
    </div>
  );
}
