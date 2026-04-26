/**
 * Standard error envelope for server actions and route handlers.
 *
 * USE this shape — module agents must not invent new error formats.
 *
 * Example:
 *   const result = await updateNote(input);
 *   if (!result.ok) return errorResponse(result);
 */
import { z } from "zod";
import { NextResponse } from "next/server";

export type Ok<T> = { ok: true; data: T };
export type Err = {
  ok: false;
  code: ErrorCode;
  message: string;
  fields?: Record<string, string[]>;
};
export type Result<T> = Ok<T> | Err;

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "UPSTREAM"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  UPSTREAM: 502,
  INTERNAL: 500,
};

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(code: ErrorCode, message: string, fields?: Record<string, string[]>): Err {
  return { ok: false, code, message, fields };
}

/**
 * Convert a zod parse error into a VALIDATION envelope.
 */
export function fromZod(error: z.ZodError): Err {
  return {
    ok: false,
    code: "VALIDATION",
    message: "Invalid input",
    fields: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * Convert a Result into a Next.js Response with the proper status code.
 */
export function toResponse<T>(result: Result<T>): NextResponse {
  if (result.ok) return NextResponse.json(result, { status: 200 });
  return NextResponse.json(result, { status: STATUS[result.code] });
}
