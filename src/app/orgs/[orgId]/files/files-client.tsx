"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { FILES_BUCKET } from "@/lib/files/constants";
import type { FileListItem } from "@/lib/files/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FilesPayload {
  role: "owner" | "admin" | "member" | "viewer";
  canUpload: boolean;
  files: FileListItem[];
}

interface ResultEnvelope<T> {
  ok: true;
  data: T;
}

interface ErrorEnvelope {
  ok: false;
  code: string;
  message: string;
  fields?: Record<string, string[]>;
}

export function FilesClient({ orgId }: { orgId: string }) {
  const [supabase] = useState(createClient);
  const [items, setItems] = useState<FileListItem[]>([]);
  const [role, setRole] = useState<FilesPayload["role"] | null>(null);
  const [canUpload, setCanUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [noteId, setNoteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshFiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    const response = await fetch(`/api/files?orgId=${encodeURIComponent(orgId)}`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as ResultEnvelope<FilesPayload> | ErrorEnvelope;

    if (!payload.ok) {
      setLoading(false);
      setError(payload.message);
      return;
    }

    setItems(payload.data.files);
    setRole(payload.data.role);
    setCanUpload(payload.data.canUpload);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setError("Choose a file first");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    const initResponse = await fetch("/api/files/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        noteId: noteId.trim() || undefined,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        sizeBytes: selectedFile.size,
      }),
    });
    const initPayload = (await initResponse.json()) as
      | ResultEnvelope<{
          fileId: string;
          storagePath: string;
          fileName: string;
          uploadToken: string;
        }>
      | ErrorEnvelope;

    if (!initPayload.ok) {
      setBusy(false);
      setError(initPayload.message);
      return;
    }

    const { fileId, storagePath, uploadToken } = initPayload.data;
    const { error: uploadError } = await supabase.storage
      .from(FILES_BUCKET)
      .uploadToSignedUrl(storagePath, uploadToken, selectedFile, {
        contentType: selectedFile.type || "application/octet-stream",
      });

    if (uploadError) {
      await fetch(`/api/files/${fileId}`, { method: "DELETE" });
      setBusy(false);
      setError(uploadError.message);
      return;
    }

    setSelectedFile(null);
    setNoteId("");
    setNotice("Upload complete");
    setBusy(false);
    await refreshFiles();
  }

  async function handleDelete(fileId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
    const payload = (await response.json()) as ResultEnvelope<{ deleted: true }> | ErrorEnvelope;

    if (!payload.ok) {
      setBusy(false);
      setError(payload.message);
      return;
    }

    setNotice("File deleted");
    setBusy(false);
    await refreshFiles();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Files</h1>
          <p className="text-sm text-muted-foreground">
            Private org storage with signed uploads and short-lived signed downloads.
          </p>
        </div>
        <div className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
          role: {role ?? "…"}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr,1.9fr]">
        <Card className="border-slate-300/80 bg-slate-50/60">
          <CardHeader>
            <CardTitle>Upload</CardTitle>
            <CardDescription>
              Files are stored under org-prefixed paths in a private Supabase bucket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canUpload ? (
              <form onSubmit={handleUpload} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">File</Label>
                  <Input
                    id="file"
                    type="file"
                    disabled={busy}
                    onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-id">Attach to note ID (optional)</Label>
                  <Input
                    id="note-id"
                    value={noteId}
                    disabled={busy}
                    onChange={(event) => setNoteId(event.target.value)}
                    placeholder="UUID of a note you can edit"
                  />
                </div>
                <Button type="submit" disabled={busy || !selectedFile}>
                  {busy ? "Uploading…" : "Upload file"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  This screen supports org files directly. Attachments to specific note screens stay
                  with the notes module.
                </p>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Viewers can browse files, but only members and admins can upload.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-300/80">
          <CardHeader>
            <CardTitle>Library</CardTitle>
            <CardDescription>
              Download links are generated per request and expire quickly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
            {loading ? <p className="text-sm text-muted-foreground">Loading files…</p> : null}
            {!loading && items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
            ) : null}

            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.fileName}</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-600">
                        {item.mimeType}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatBytes(item.sizeBytes)} · uploaded by {item.uploadedByLabel} ·{" "}
                      {formatTimestamp(item.createdAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.noteId ? (
                        <>
                          Attached to note:{" "}
                          <span className="font-medium text-foreground">
                            {item.noteTitle ?? item.noteId}
                          </span>
                        </>
                      ) : (
                        "Org file"
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/api/files/${item.id}/download`} target="_blank" rel="noreferrer">
                        Download
                      </Link>
                    </Button>
                    {item.canDelete ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleDelete(item.id)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}
