"use client";

import { useState } from "react";

interface Props {
  cleartext: string;
  name: string;
}

/**
 * One-shot reveal banner for a freshly-created agent token. The cleartext is
 * passed in once via a server-rendered prop (originally from a flash cookie
 * the parent page cleared on read) and is shown verbatim with a copy button.
 *
 * No retry: closing or copying does not preserve the value. The only place
 * the cleartext exists is in this DOM tree's render — when the user navigates
 * away it's gone forever, by design.
 */
export function CreatedTokenBanner({ cleartext, name }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(cleartext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy token", cleartext);
    }
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm space-y-2">
      <p className="font-medium text-amber-900">
        Token “{name}” created. Copy it now — it will not be shown again.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded border border-amber-200 bg-white px-3 py-2 font-mono text-xs">
          {cleartext}
        </code>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded bg-amber-700 px-3 py-2 text-xs font-medium text-white hover:bg-amber-800"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-amber-800">
        Use as the <code>Authorization: Bearer …</code> header for{" "}
        <code>/agent/*</code> and <code>/mcp</code>, or set as{" "}
        <code>MEMORY_AGENT_TOKEN</code> in the shell where Claude Code runs.
      </p>
    </div>
  );
}
