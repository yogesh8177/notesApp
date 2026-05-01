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
  Search,
  Wrench,
  Database,
  Bot,
  AlertCircle,
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
  if (action === "search.execute")
    return { icon: Search, colour: "bg-sky-100 text-sky-700", label: "Search" };
  if (action === "mcp.tool.call")
    return { icon: Wrench, colour: "bg-violet-100 text-violet-700", label: "Tool call" };
  if (action === "mcp.tool.error")
    return { icon: AlertCircle, colour: "bg-rose-100 text-rose-700", label: "Tool error" };
  if (action === "mcp.resource.read")
    return { icon: Database, colour: "bg-zinc-100 text-zinc-600", label: "Resource read" };
  if (action === "mcp.resource.error")
    return { icon: AlertCircle, colour: "bg-rose-100 text-rose-700", label: "Resource error" };
  if (action === "agent.event.subagent.start")
    return { icon: Bot, colour: "bg-emerald-100 text-emerald-700", label: "Subagent started" };
  if (action === "agent.event.subagent.stop")
    return { icon: Bot, colour: "bg-zinc-100 text-zinc-600", label: "Subagent stopped" };
  if (action === "agent.event.subagent.tool.call")
    return { icon: Wrench, colour: "bg-sky-100 text-sky-700", label: "Subagent tool call" };
  if (action === "agent.session.bootstrap")
    return { icon: Bot, colour: "bg-emerald-100 text-emerald-700", label: "Session started" };
  if (action === "agent.session.checkpoint")
    return { icon: Bot, colour: "bg-sky-100 text-sky-700", label: "Checkpoint" };
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
  if (action === "permission.denied") return <span>Permission denied on this note</span>;

  if (action === "search.execute") {
    const q = typeof meta.q === "string" ? meta.q : "";
    const resultCount = typeof meta.resultCount === "number" ? meta.resultCount : null;
    const latencyMs = typeof meta.latencyMs === "number" ? meta.latencyMs : null;
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Searched for <span className="font-medium">&ldquo;{q}&rdquo;</span></span>
        {resultCount !== null && <span className="text-xs text-muted-foreground">— {resultCount} result{resultCount !== 1 ? "s" : ""}</span>}
        {latencyMs !== null && <span className="text-xs text-muted-foreground">in {latencyMs}ms</span>}
      </span>
    );
  }

  if (action === "mcp.tool.call" || action === "mcp.tool.error") {
    const toolName = typeof event.resourceId === "string" ? event.resourceId : "unknown";
    const tokenName = typeof meta.tokenName === "string" ? meta.tokenName : null;
    const durationMs = typeof meta.durationMs === "number" ? meta.durationMs : null;
    const error = typeof meta.error === "string" ? meta.error : null;
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>{action === "mcp.tool.error" ? "Tool error" : "Called tool"} <span className="font-mono text-xs font-medium">{toolName}</span></span>
        {tokenName && <span className="text-xs text-muted-foreground">via {tokenName}</span>}
        {durationMs !== null && !error && <span className="text-xs text-muted-foreground">{durationMs}ms</span>}
        {error && <span className="text-xs text-rose-600 truncate max-w-xs" title={error}>{error}</span>}
      </span>
    );
  }

  if (action === "mcp.resource.read" || action === "mcp.resource.error") {
    const resourceName = typeof event.resourceId === "string" ? event.resourceId : "unknown";
    const tokenName = typeof meta.tokenName === "string" ? meta.tokenName : null;
    const durationMs = typeof meta.durationMs === "number" ? meta.durationMs : null;
    const error = typeof meta.error === "string" ? meta.error : null;
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>{action === "mcp.resource.error" ? "Resource error" : "Read resource"} <span className="font-mono text-xs font-medium">{resourceName}</span></span>
        {tokenName && <span className="text-xs text-muted-foreground">via {tokenName}</span>}
        {durationMs !== null && !error && <span className="text-xs text-muted-foreground">{durationMs}ms</span>}
        {error && <span className="text-xs text-rose-600 truncate max-w-xs" title={error}>{error}</span>}
      </span>
    );
  }

  if (action === "agent.event.subagent.start" || action === "agent.event.subagent.stop") {
    const agentType = typeof meta.agentType === "string" ? meta.agentType : null;
    const agentId = typeof meta.agentId === "string" ? meta.agentId : null;
    const tokenName = typeof meta.tokenName === "string" ? meta.tokenName : null;
    const verb = action === "agent.event.subagent.start" ? "started" : "stopped";
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Subagent {agentType ? <span className="font-medium">{agentType}</span> : "unknown"} {verb}</span>
        {tokenName && <span className="text-xs text-muted-foreground">via {tokenName}</span>}
        {agentId && <span className="font-mono text-xs text-muted-foreground" title={agentId}>{agentId.slice(0, 8)}</span>}
      </span>
    );
  }

  if (action === "agent.event.subagent.tool.call") {
    const toolName = typeof meta.toolName === "string" ? meta.toolName : null;
    const agentType = typeof meta.agentType === "string" ? meta.agentType : null;
    const tokenName = typeof meta.tokenName === "string" ? meta.tokenName : null;
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Subagent called{toolName ? <> tool <span className="font-mono text-xs font-medium">{toolName}</span></> : " a tool"}</span>
        {agentType && <span className="text-xs text-muted-foreground">({agentType})</span>}
        {tokenName && <span className="text-xs text-muted-foreground">via {tokenName}</span>}
      </span>
    );
  }

  if (action === "agent.session.bootstrap") {
    const agentId = typeof meta.agentId === "string" ? meta.agentId : null;
    const branch = typeof meta.branch === "string" ? meta.branch : null;
    const tokenName = typeof meta.tokenName === "string" ? meta.tokenName : null;
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Agent session started</span>
        {branch && <span className="font-mono text-xs text-muted-foreground">@ {branch}</span>}
        {tokenName && <span className="text-xs text-muted-foreground">via {tokenName}</span>}
        {agentId && <span className="font-mono text-xs text-muted-foreground" title={agentId}>{agentId.slice(0, 8)}</span>}
      </span>
    );
  }

  if (action === "agent.session.checkpoint") {
    const event2 = typeof meta.event === "string" ? meta.event : null;
    const lastCommit = typeof meta.lastCommit === "string" ? meta.lastCommit : null;
    const tokenName = typeof meta.tokenName === "string" ? meta.tokenName : null;
    return (
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span>Checkpoint{event2 ? <span className="text-muted-foreground"> — {event2}</span> : ""}</span>
        {lastCommit && (
          <a
            href={`https://github.com/yogesh8177/notesApp/commit/${lastCommit}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-muted-foreground hover:underline"
            title={lastCommit}
          >
            {lastCommit.slice(0, 8)}
          </a>
        )}
        {tokenName && <span className="text-xs text-muted-foreground">via {tokenName}</span>}
      </span>
    );
  }

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
