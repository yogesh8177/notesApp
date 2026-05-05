"use client";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof Button>, "disabled"> & {
  pendingText?: string;
  disabled?: boolean;
};

export function SubmitButton({ children, pendingText, disabled, ...props }: Props) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <Button {...props} type="submit" disabled={isDisabled} aria-disabled={isDisabled}>
      {pending ? (pendingText ?? "…") : children}
    </Button>
  );
}
