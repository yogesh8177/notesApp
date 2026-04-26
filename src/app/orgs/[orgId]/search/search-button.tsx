"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SearchSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit">
      {pending ? "Searching…" : "Search"}
    </Button>
  );
}
