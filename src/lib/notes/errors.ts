import { ZodError } from "zod";
import { err, fromZod, type Err, type ErrorCode } from "@/lib/validation/result";
import { ForbiddenError } from "@/lib/auth/org";
import { PermissionError } from "@/lib/auth/permissions";

export class NotesError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "NotesError";
  }
}

export function toNotesErr(error: unknown): Err {
  if (error instanceof NotesError) {
    return err(error.code, error.message, error.fields);
  }
  if (error instanceof ZodError) {
    return fromZod(error);
  }
  if (error instanceof PermissionError || error instanceof ForbiddenError) {
    return err("FORBIDDEN", error.message);
  }
  return err("INTERNAL", "Unexpected notes error");
}
