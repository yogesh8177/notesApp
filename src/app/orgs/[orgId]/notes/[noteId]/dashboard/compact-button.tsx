"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Layers } from "lucide-react";
import { compactHistory } from "./actions";

interface Props {
  noteId: string;
  orgId: string;
}

export function CompactButton({ noteId, orgId }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setState("loading");
    setMessage("");
    try {
      const result = await compactHistory(noteId, orgId);
      if (result.ok) {
        setState("done");
        setMessage(`Compacted to v${result.data.version}`);
      } else {
        setState("error");
        setMessage(result.message ?? "Failed");
      }
    } catch {
      setState("error");
      setMessage("Unexpected error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={state === "loading" || state === "done"}
      >
        {state === "loading" ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Layers className="mr-2 h-3.5 w-3.5" />
        )}
        {state === "done" ? "Compacted" : "Compact History"}
      </Button>
      {message && (
        <span className={`text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
