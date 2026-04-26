"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface GenerateResponse {
  ok: boolean;
  message?: string;
  data?: {
    provider: string;
    model: string;
  };
}

export function GenerateSummaryButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      setStatusMessage(null);

      try {
        const response = await fetch(`/api/ai/notes/${noteId}/summary`, {
          method: "POST",
        });

        const payload = (await response.json()) as GenerateResponse;
        if (!response.ok || !payload.ok) {
          setStatusMessage(payload.message ?? "Summary generation failed");
          return;
        }

        setStatusMessage(
          `Summary generated with ${payload.data?.provider ?? "provider"} (${payload.data?.model ?? "model"})`,
        );
        router.refresh();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "Summary generation failed");
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        className="inline-flex rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        disabled={isPending}
        onClick={handleGenerate}
        type="button"
      >
        {isPending ? "Generating..." : "Generate summary"}
      </button>
      {statusMessage ? <p className="text-sm text-muted-foreground">{statusMessage}</p> : null}
    </div>
  );
}
