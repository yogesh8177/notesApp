"use client";

import { useState } from "react";

interface Props {
  token: string;
}

export function CopyInviteLink({ token }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const link = `${window.location.origin}/orgs/invite/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for browsers without clipboard API: open a prompt
      window.prompt("Copy invite link", link);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="text-xs underline text-primary hover:opacity-80"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
