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

export const log = pino({
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
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true, translateTime: "HH:MM:ss.l" },
        },
      }),
});

export type Logger = typeof log;
