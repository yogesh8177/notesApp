import {
  FilePlus,
  FileMinus,
  Pencil,
  Share2,
  UserMinus,
  Sparkles,
  CheckCheck,
  Lock,
  Activity,
} from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getNoteTimeline, type TimelineEvent } from "@/lib/timeline/queries";
import { cn } from "@/lib/utils";

interface ActionMeta {
  icon: React.ElementType;
  colour: string;
  label: string;
}

function getActionMeta(action: string): ActionMeta {
  if (action === "note.create")
    return { icon: FilePlus, colour: "bg-emerald-100 text-emerald-700", label: "Created" };
  if (action === "note.update")
    return { icon: Pencil, colour: "bg-sky-100 text-sky-700", label: "Updated" };
  if (action === "note.delete")
    return { icon: FileMinus, colour: "bg-rose-100 text-rose-700", label: "Deleted" };
  if (action === "note.share")
    return { icon: Share2, colour: "bg-violet-100 text-violet-700", label: "Shared" };
  if (action === "note.unshare")
    return { icon: UserMinus, colour: "bg-orange-100 text-orange-700", label: "Unshared" };
  if (action === "ai.summary.request")
    return { icon: Sparkles, colour: "bg-violet-100 text-violet-700", label: "Summary requested" };
  if (action === "ai.summary.complete" || action === "ai.summary.fallback")
    return { icon: Sparkles, colour: "bg-emerald-100 text-emerald-700", label: "Summary ready" };
  if (action === "ai.summary.fail")
    return { icon: Sparkles, colour: "bg-rose-100 text-rose-700", label: "Summary failed" };
  if (action === "ai.summary.accept")
    return { icon: CheckCheck, colour: "bg-emerald-100 text-emerald-700", label: "Summary accepted" };
  if (action === "permission.denied")
    return { icon: Lock, colour: "bg-rose-100 text-rose-700", label: "Permission denied" };
  return { icon: Activity, colour: "bg-zinc-100 text-zinc-600", label: action };
}

function actorName(actor: TimelineEvent["actor"]): string {
  return actor.displayName ?? actor.email ?? "System";
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function EventDescription({ event }: { event: TimelineEvent }) {
  const { action } = event;
  const meta = event.metadata;

  if (action === "note.create") return <span>Created this note</span>;
  if (action === "note.update") return <span>Edited this note</span>;
  if (action === "note.delete") return <span>Deleted this note</span>;
  if (action === "note.share") {
    const perm = typeof meta.permission === "string" ? meta.permission : "";
    return (
      <span>
        Shared this note{perm ? <span className="text-xs text-muted-foreground ml-1">({perm})</span> : null}
      </span>
    );
  }
  if (action === "note.unshare") return <span>Removed a share</span>;
  if (action === "ai.summary.request") return <span>Requested AI summary</span>;
  if (action === "ai.summary.complete" || action === "ai.summary.fallback") {
    const provider = typeof meta.provider === "string" ? meta.provider : "";
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>AI summary ready</span>
        {provider && <span className="text-xs text-muted-foreground">via {provider}</span>}
      </span>
    );
  }
  if (action === "ai.summary.fail") return <span>AI summary failed</span>;
  if (action === "ai.summary.accept") return <span>Accepted AI summary</span>;
  if (action === "permission.denied")
    return <span>Permission denied on this note</span>;

  return <span className="text-muted-foreground">{action}</span>;
}

function TimelineItem({
  event,
  isLast,
}: {
  event: TimelineEvent;
  isLast: boolean;
}) {
  const meta = getActionMeta(event.action);
  const Icon = meta.icon;

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.colour)}>
          <Icon className="h-4 w-4" />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className="pb-6 pt-1 min-w-0">
        <p className="text-sm leading-5">
          <span className="font-medium">{actorName(event.actor)}</span>{" "}
          <EventDescription event={event} />
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatTime(event.createdAt)}</p>
      </div>
    </div>
  );
}

export default async function NoteTimelinePage({
  params,
}: {
  params: Promise<{ orgId: string; noteId: string }>;
}) {
  const { orgId, noteId } = await params;
  await requireUser(`/orgs/${orgId}/notes/${noteId}/timeline`);

  const events = await getNoteTimeline(orgId, noteId, 100);

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No activity yet</CardTitle>
          <CardDescription>Events will appear here as this note is edited, shared, or summarised.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const groups: Array<{ date: Date; events: TimelineEvent[] }> = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (last && isSameDay(last.date, event.createdAt)) {
      last.events.push(event);
    } else {
      groups.push({ date: event.createdAt, events: [event] });
    }
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.date.toISOString()}>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground">{formatDate(group.date)}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div>
            {group.events.map((event, idx) => (
              <TimelineItem
                key={event.id}
                event={event}
                isLast={idx === group.events.length - 1}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
