"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { FILES_BUCKET } from "@/lib/files/constants";
import type { FileListItem } from "@/lib/files/types";
import { Button } from "@/components/ui/button";

const MAX_FILES = 5;

interface NoteFilesPayload {
  files: FileListItem[];
  maxFiles: number;
}

interface Ok<T> { ok: true; data: T }
interface Err { ok: false; code: string; message: string }

interface Props {
  noteId: string;
  orgId: string;
  canWrite?: boolean;
}

export function NoteFileUploader({ noteId, orgId, canWrite = true }: Props) {
  const [supabase] = useState(createClient);
  const [items, setItems] = useState<FileListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/files?noteId=${encodeURIComponent(noteId)}`, { cache: "no-store" });
    const payload = (await res.json()) as Ok<NoteFilesPayload> | Err;
    setLoading(false);
    if (!payload.ok) { setError(payload.message); return; }
    setItems(payload.data.files);
  }, [noteId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;

    const available = MAX_FILES - items.length;
    const toUpload = picked.slice(0, available);

    if (picked.length > available) {
      setError(`Only ${available} slot(s) remaining (max ${MAX_FILES}). Uploading first ${available}.`);
    } else {
      setError(null);
    }

    setBusy(true);
    for (const file of toUpload) {
      const initRes = await fetch("/api/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          noteId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      const initPayload = (await initRes.json()) as
        | Ok<{ fileId: string; storagePath: string; uploadToken: string }>
        | Err;

      if (!initPayload.ok) {
        setError(initPayload.message);
        break;
      }

      const { fileId, storagePath, uploadToken } = initPayload.data;
      const { error: uploadErr } = await supabase.storage
        .from(FILES_BUCKET)
        .uploadToSignedUrl(storagePath, uploadToken, file, {
          contentType: file.type || "application/octet-stream",
        });

      if (uploadErr) {
        await fetch(`/api/files/${fileId}`, { method: "DELETE" });
        setError(uploadErr.message);
        break;
      }
    }

    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refresh();
  }

  async function handleDelete(fileId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
    const payload = (await res.json()) as Ok<unknown> | Err;
    if (!payload.ok) setError(payload.message);
    setBusy(false);
    await refresh();
  }

  const atCap = items.length >= MAX_FILES;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Attachments</h3>
        <span className="text-xs text-muted-foreground">{items.length}/{MAX_FILES}</span>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}

      {!loading && items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.fileName}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(item.sizeBytes)}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/files/${item.id}/download`} target="_blank" rel="noreferrer">
                    Download
                  </a>
                </Button>
                {item.canDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleDelete(item.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files attached.</p>
      ) : null}

      {canWrite ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={busy || atCap}
            className="hidden"
            id={`file-upload-${noteId}`}
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || atCap}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? "Uploading…" : atCap ? "Limit reached" : "Attach files"}
          </Button>
          {atCap ? (
            <p className="mt-1 text-xs text-muted-foreground">Maximum of {MAX_FILES} files per note.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
