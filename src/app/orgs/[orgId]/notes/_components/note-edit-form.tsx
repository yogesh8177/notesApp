"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "./submit-button";

interface NoteEditFormProps {
  title: string;
  content: string;
  visibility: "private" | "org" | "shared";
  tags: string[];
  canShare: boolean;
  canDelete: boolean;
  updateAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
}

function normTagsForCompare(value: string): string {
  return value
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

export function NoteEditForm({
  title: initialTitle,
  content: initialContent,
  visibility: initialVisibility,
  tags: initialTagsArray,
  canShare,
  canDelete,
  updateAction,
  deleteAction,
}: NoteEditFormProps) {
  const initialTags = initialTagsArray.join(", ");

  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [tags, setTags] = useState(initialTags);

  const isDirty =
    title !== initialTitle ||
    content !== initialContent ||
    visibility !== initialVisibility ||
    normTagsForCompare(tags) !== normTagsForCompare(initialTags);

  return (
    <form action={updateAction} className="space-y-4">
      <Input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        name="content"
        rows={16}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="grid gap-3 md:grid-cols-3">
        <select
          name="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof initialVisibility)}
          disabled={!canShare}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
        >
          <option value="private">Private</option>
          <option value="org">Org visible</option>
          <option value="shared">Shared only</option>
        </select>
        <Input
          name="tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="one, two, three"
        />
        <Input name="changeSummary" placeholder="What changed?" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText="Saving…" disabled={!isDirty}>
          Save changes
        </SubmitButton>
        {canDelete ? (
          <SubmitButton formAction={deleteAction} variant="destructive" pendingText="Deleting…">
            Delete note
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
