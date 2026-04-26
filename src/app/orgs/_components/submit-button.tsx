"use client";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string };

export function SubmitButton({ children, pendingText, className, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <button {...props} type="submit" disabled={pending} aria-disabled={pending} className={cn(className, pending && "opacity-60 cursor-not-allowed")}>
      {pending ? (pendingText ?? "…") : children}
    </button>
  );
}
