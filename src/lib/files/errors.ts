import { type ErrorCode } from "@/lib/validation/result";
import { PermissionError } from "@/lib/auth/permissions";
import { log } from "@/lib/log";

export class FilesError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "FilesError";
  }
}

export function toFilesError(error: unknown, fallbackMessage: string): FilesError {
  if (error instanceof FilesError) {
    return error;
  }
  if (error instanceof PermissionError) {
    if (error.reason === "not-found") {
      return new FilesError("NOT_FOUND", "Note not found");
    }
    return new FilesError("FORBIDDEN", "You do not have access to that note");
  }

  log.error({ err: error }, "files.unhandled_error");
  return new FilesError("INTERNAL", fallbackMessage);
}
