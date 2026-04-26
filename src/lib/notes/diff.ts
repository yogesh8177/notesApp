import { diffLines } from "diff";

export interface DiffLine {
  kind: "added" | "removed" | "unchanged";
  text: string;
}

export interface NoteVersionDiff {
  titleChanged: boolean;
  contentChanged: boolean;
  title: DiffLine[];
  content: DiffLine[];
}

function chunkKind(chunk: { added?: boolean; removed?: boolean }): DiffLine["kind"] {
  if (chunk.added) return "added";
  if (chunk.removed) return "removed";
  return "unchanged";
}

function toLines(left: string, right: string) {
  return diffLines(left, right, { newlineIsToken: true }).flatMap((chunk) =>
    chunk.value.split("\n").map((line, index, lines) => ({
      kind: chunkKind(chunk),
      text: index === lines.length - 1 ? line : `${line}\n`,
    })),
  );
}

export function buildVersionDiff(previous: { title: string; content: string }, current: {
  title: string;
  content: string;
}): NoteVersionDiff {
  return {
    titleChanged: previous.title !== current.title,
    contentChanged: previous.content !== current.content,
    title: toLines(previous.title, current.title),
    content: toLines(previous.content, current.content),
  };
}
