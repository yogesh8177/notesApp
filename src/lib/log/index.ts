import pino from "pino";
import { env } from "@/lib/env";

/**
 * Structured logger. Use this everywhere instead of console.log.
 *
 * In dev, output is pretty-printed; in production, it's JSON for log shippers.
 *
 * Conventions:
 *   - Always pass the object first, then the message:
 *       log.info({ orgId, noteId }, "note.update");
 *   - Use the `audit()` helper for events that must also persist to audit_log.
 *   - Never log secrets, tokens, or full note bodies. Use `redact` if unsure.
 */
const isProd = env.NODE_ENV === "production";

const baseOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: "notes-app",
    env: env.NODE_ENV,
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "headers.cookie",
      "headers.authorization",
    ],
    censor: "[redacted]",
  },
};

// In dev, pipe through pino-pretty as a synchronous stream rather than using
// the `transport` option. `transport` spawns a worker_thread that Next.js dev
// server recycles between requests, causing "the worker has exited" errors in
// Server Actions and route handlers. A synchronous stream has no worker thread.
function buildLogger() {
  if (isProd) {
    return pino(baseOptions);
  }
  const pretty = require("pino-pretty") as (opts: Record<string, unknown>) => NodeJS.WritableStream;
  const stream = pretty({ colorize: true, singleLine: true, translateTime: "HH:MM:ss.l" });
  return pino(baseOptions, stream);
}

export const log = buildLogger();

export type Logger = typeof log;
