import Link from "next/link";
import type { DiffLine } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function VisibilityBadge({ visibility }: { visibility: "private" | "org" | "shared" }) {
  const tone =
    visibility === "private"
      ? "bg-zinc-100 text-zinc-700"
      : visibility === "org"
        ? "bg-sky-100 text-sky-700"
        : "bg-amber-100 text-amber-700";

  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize", tone)}>
      {visibility}
    </span>
  );
}

export function FlashNotice({
  message,
  error,
}: {
  message?: string | null;
  error?: string | null;
}) {
  if (!message && !error) return null;
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        error
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {error ?? message}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href?: string;
  cta?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {href && cta ? (
        <CardContent>
          <Link href={href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {cta}
          </Link>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function DiffBlock({
  label,
  lines,
}: {
  label: string;
  lines: DiffLine[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-4 text-sm leading-6">
        {lines.map((line, index) => (
          <span
            key={`${label}-${index}`}
            className={cn(
              "block whitespace-pre-wrap",
              line.kind === "added" && "bg-emerald-100/80 text-emerald-900",
              line.kind === "removed" && "bg-rose-100/80 text-rose-900",
            )}
          >
            {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
            {line.text || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}
