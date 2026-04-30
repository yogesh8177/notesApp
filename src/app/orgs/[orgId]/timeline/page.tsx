import Link from "next/link";
import {
  FileText,
  FilePlus,
  FileMinus,
  Pencil,
  Share2,
  UserMinus,
  Upload,
  Download,
  Trash2,
  Sparkles,
  CheckCheck,
  Building2,
  UserPlus,
  UserCheck,
  ShieldCheck,
  LogIn,
  LogOut,
  Lock,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getOrgTimeline, type TimelineEvent } from "@/lib/timeline/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Icon + colour per action
// ---------------------------------------------------------------------------

interface ActionMeta {
  icon: React.ElementType;
  colour: string;
  label: string;
}

function getActionMeta(action: string): ActionMeta {
  if (action === "note.create")
    return { icon: FilePlus, colour: "bg-emerald-100 text-emerald-700", label: "Created note" };
  if (action === "note.update")
    return { icon: Pencil, colour: "bg-sky-100 text-sky-700", label: "Updated note" };
  if (action === "note.delete")
    return { icon: FileMinus, colour: "bg-rose-100 text-rose-700", label: "Deleted note" };
  if (action === "note.share")
    return { icon: Share2, colour: "bg-violet-100 text-violet-700", label: "Shared note" };
  if (action === "note.unshare")
    return { icon: UserMinus, colour: "bg-orange-100 text-orange-700", label: "Unshared note" };
  if (action === "file.upload")
    return { icon: Upload, colour: "bg-sky-100 text-sky-700", label: "Uploaded file" };
  if (action === "file.download")
    return { icon: Download, colour: "bg-zinc-100 text-zinc-600", label: "Downloaded file" };
  if (action === "file.delete")
    return { icon: Trash2, colour: "bg-rose-100 text-rose-700", label: "Deleted file" };
  if (action === "ai.summary.request")
    return { icon: Sparkles, colour: "bg-violet-100 text-violet-700", label: "Requested AI summary" };
  if (action === "ai.summary.complete" || action === "ai.summary.fallback")
    return { icon: Sparkles, colour: "bg-emerald-100 text-emerald-700", label: "AI summary ready" };
  if (action === "ai.summary.fail")
    return { icon: Sparkles, colour: "bg-rose-100 text-rose-700", label: "AI summary failed" };
  if (action === "ai.summary.accept")
    return { icon: CheckCheck, colour: "bg-emerald-100 text-emerald-700", label: "Accepted AI summary" };
  if (action === "org.create")
    return { icon: Building2, colour: "bg-emerald-100 text-emerald-700", label: "Created org" };
  if (action === "org.invite")
    return { icon: UserPlus, colour: "bg-sky-100 text-sky-700", label: "Sent invite" };
  if (action === "org.invite.accept")
    return { icon: UserCheck, colour: "bg-emerald-100 text-emerald-700", label: "Accepted invite" };
  if (action === "org.role.change")
    return { icon: ShieldCheck, colour: "bg-orange-100 text-orange-700", label: "Role changed" };
  if (action === "auth.signin")
    return { icon: LogIn, colour: "bg-zinc-100 text-zinc-600", label: "Signed in" };
  if (action === "auth.signout")
    return { icon: LogOut, colour: "bg-zinc-100 text-zinc-600", label: "Signed out" };
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
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EventDescription({
  event,
  orgId,
}: {
  event: TimelineEvent;
  orgId: string;
}) {
  const { action, noteId, noteTitle, noteDeleted } = event;

  const noteLink =
    noteId && !noteDeleted ? (
      <Link
        href={`/orgs/${orgId}/notes/${noteId}`}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        {noteTitle ?? "Untitled"}
      </Link>
    ) : noteTitle ? (
      <span className="font-medium text-muted-foreground line-through" title="Note deleted">
        {noteTitle}
      </span>
    ) : null;

  const historyLink =
    noteId && !noteDeleted ? (
      <Link
        href={`/orgs/${orgId}/notes/${noteId}/history`}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        view history
      </Link>
    ) : null;

  const summaryLink =
    noteId && !noteDeleted ? (
      <Link
        href={`/orgs/${orgId}/notes/${noteId}/summary`}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        view summary
      </Link>
    ) : null;

  if (action === "note.create") {
    return (
      <span>
        Created note {noteLink}
      </span>
    );
  }
  if (action === "note.update") {
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Updated note {noteLink}</span>
        {historyLink ? <span className="text-muted-foreground">·</span> : null}
        {historyLink}
      </span>
    );
  }
  if (action === "note.delete") {
    return <span>Deleted note {noteLink ?? <span className="font-medium">{event.resourceId?.slice(0, 8)}</span>}</span>;
  }
  if (action === "note.share") {
    const perm = typeof event.metadata.permission === "string" ? event.metadata.permission : "";
    return (
      <span>
        Shared note {noteLink} {perm ? <span className="text-xs text-muted-foreground">({perm})</span> : null}
      </span>
    );
  }
  if (action === "note.unshare") {
    return <span>Removed share on note {noteLink}</span>;
  }
  if (action === "file.upload") {
    const fileName = typeof event.metadata.fileName === "string" ? event.metadata.fileName : "file";
    return <span>Uploaded <span className="font-medium">{fileName}</span></span>;
  }
  if (action === "file.download") {
    return <span>Downloaded a file</span>;
  }
  if (action === "file.delete") {
    return <span>Deleted a file</span>;
  }
  if (action === "ai.summary.request") {
    return <span>Requested AI summary for note {noteLink}</span>;
  }
  if (action === "ai.summary.complete" || action === "ai.summary.fallback") {
    const provider = typeof event.metadata.provider === "string" ? event.metadata.provider : "";
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>AI summary ready for note {noteLink}</span>
        {provider ? <span className="text-xs text-muted-foreground">via {provider}</span> : null}
        {summaryLink ? <span className="text-muted-foreground">·</span> : null}
        {summaryLink}
      </span>
    );
  }
  if (action === "ai.summary.fail") {
    return <span>AI summary failed for note {noteLink}</span>;
  }
  if (action === "ai.summary.accept") {
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Accepted AI summary for note {noteLink}</span>
        {summaryLink ? <span className="text-muted-foreground">·</span> : null}
        {summaryLink}
      </span>
    );
  }
  if (action === "org.create") return <span>Created this organisation</span>;
  if (action === "org.invite") return <span>Sent an organisation invite</span>;
  if (action === "org.invite.accept") return <span>Accepted an organisation invite</span>;
  if (action === "org.role.change") {
    const newRole = typeof event.metadata.newRole === "string" ? event.metadata.newRole : "";
    return <span>Changed a member's role{newRole ? ` to ${newRole}` : ""}</span>;
  }
  if (action === "auth.signin") return <span>Signed in</span>;
  if (action === "auth.signout") return <span>Signed out</span>;
  if (action === "permission.denied") return <span>Permission denied on {event.resourceType ?? "resource"}</span>;

  return <span className="text-muted-foreground">{action}</span>;
}

function TimelineItem({
  event,
  orgId,
  isLast,
}: {
  event: TimelineEvent;
  orgId: string;
  isLast: boolean;
}) {
  const meta = getActionMeta(event.action);
  const Icon = meta.icon;

  return (
    <div className="flex gap-4">
      {/* Connector line */}
      <div className="flex flex-col items-center">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", meta.colour)}>
          <Icon className="h-4 w-4" />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div className="pb-6 pt-1 min-w-0">
        <p className="text-sm leading-5">
          <span className="font-medium">{actorName(event.actor)}</span>{" "}
          <EventDescription event={event} orgId={orgId} />
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatTime(event.createdAt)}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  await requireUser(`/orgs/${orgId}/timeline`);

  const events = await getOrgTimeline(orgId, 100);

  if (events.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Timeline</h1>
          <p className="text-sm text-muted-foreground">Activity log for this organisation.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>No activity yet</CardTitle>
            <CardDescription>Events will appear here as your team works in this organisation.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Group events by day
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Recent activity in this organisation — last {events.length} events.
        </p>
      </div>

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
                  orgId={orgId}
                  isLast={idx === group.events.length - 1}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
