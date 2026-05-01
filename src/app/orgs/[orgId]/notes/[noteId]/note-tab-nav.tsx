"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE = "rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition-colors";
const ACTIVE = "bg-background text-foreground border-b-background";
const INACTIVE = "hover:bg-muted text-muted-foreground";

interface Tab {
  label: string;
  href: string;
  exact: boolean;
}

export function NoteTabNav({ orgId, noteId }: { orgId: string; noteId: string }) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { label: "Note", href: `/orgs/${orgId}/notes/${noteId}`, exact: true },
    { label: "AI Summary", href: `/orgs/${orgId}/notes/${noteId}/summary`, exact: false },
    { label: "Timeline", href: `/orgs/${orgId}/notes/${noteId}/timeline`, exact: false },
    { label: "Dashboard", href: `/orgs/${orgId}/notes/${noteId}/dashboard`, exact: false },
    { label: "Conversation", href: `/orgs/${orgId}/notes/${noteId}/conversation`, exact: false },
  ];

  return (
    <nav className="flex gap-1 border-b pb-0">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${BASE} ${isActive ? ACTIVE : INACTIVE}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
