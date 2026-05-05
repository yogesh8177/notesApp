import { describe, it, expect } from "vitest";
import { ok, err, fromZod, toResponse } from "@/lib/validation/result";
import { z } from "zod";

describe("ok", () => {
  it("returns an Ok with the supplied data", () => {
    const r = ok({ id: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ id: 1 });
  });
});

describe("err", () => {
  it("returns an Err with code and message", () => {
    const r = err("NOT_FOUND", "resource missing");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("NOT_FOUND");
      expect(r.message).toBe("resource missing");
    }
  });

  it("carries optional fields", () => {
    const fields = { name: ["required"] };
    const r = err("VALIDATION", "bad input", fields);
    if (!r.ok) expect(r.fields).toEqual(fields);
  });
});

describe("fromZod", () => {
  it("produces a VALIDATION Err from a ZodError", () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() });
    const parsed = schema.safeParse({ name: "", age: "x" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const r = fromZod(parsed.error);
      expect(r.ok).toBe(false);
      expect(r.code).toBe("VALIDATION");
      expect(r.fields).toBeDefined();
    }
  });
});

describe("toResponse", () => {
  it("returns 200 for Ok results", async () => {
    const res = toResponse(ok({ x: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 404 for NOT_FOUND", async () => {
    const res = toResponse(err("NOT_FOUND", "missing"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for FORBIDDEN", async () => {
    const res = toResponse(err("FORBIDDEN", "denied"));
    expect(res.status).toBe(403);
  });

  it("returns 422 for VALIDATION", async () => {
    const res = toResponse(err("VALIDATION", "bad"));
    expect(res.status).toBe(422);
  });

  it("returns 429 for RATE_LIMITED", async () => {
    const res = toResponse(err("RATE_LIMITED", "slow down"));
    expect(res.status).toBe(429);
  });

  it("returns 500 for INTERNAL", async () => {
    const res = toResponse(err("INTERNAL", "boom"));
    expect(res.status).toBe(500);
  });

  it("returns 401 for UNAUTHORIZED", async () => {
    const res = toResponse(err("UNAUTHORIZED", "login required"));
    expect(res.status).toBe(401);
  });
});
