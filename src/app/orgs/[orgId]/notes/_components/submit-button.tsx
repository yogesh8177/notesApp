"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Button>, "disabled"> & { pendingText?: string };

export function SubmitButton({ children, pendingText, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? (pendingText ?? "…") : children}
    </Button>
  );
}
