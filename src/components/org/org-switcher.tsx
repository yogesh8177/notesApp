"use client";

import { useRouter } from "next/navigation";
import { audit } from "@/lib/log/audit";

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface OrgSwitcherProps {
  orgs: Org[];
  currentOrgId: string;
}

export function OrgSwitcher({ orgs, currentOrgId }: OrgSwitcherProps) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newOrgId = e.target.value;
    if (newOrgId === currentOrgId) return;

    // Set informational cookie (not used for auth — org is always from URL).
    document.cookie = `active_org_id=${newOrgId}; path=/; max-age=31536000; samesite=lax`;

    router.push(`/orgs/${newOrgId}/notes`);
  }

  return (
    <select
      value={currentOrgId}
      onChange={handleChange}
      className="border rounded px-2 py-1 text-sm bg-background max-w-[200px] truncate"
      aria-label="Switch organisation"
    >
      {orgs.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
