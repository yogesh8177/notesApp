import { createHash, randomBytes } from "crypto";

/** Token wire-format prefix. Lets ops grep `nat_*` from logs/notebooks safely. */
export const TOKEN_PREFIX = "nat_";

/**
 * Generate a fresh token. Returns the cleartext (shown to the user once),
 * the display prefix (first 8 chars after `nat_`), and the sha256 hash to
 * persist. Never store the cleartext.
 */
export function generateToken(): {
  cleartext: string;
  displayPrefix: string;
  hash: string;
} {
  // 32 hex chars = 128 bits. Plenty for an authentication secret with no
  // online guessing surface (each request hits the DB).
  const suffix = randomBytes(16).toString("hex");
  const cleartext = `${TOKEN_PREFIX}${suffix}`;
  return {
    cleartext,
    displayPrefix: suffix.slice(0, 8),
    hash: hashToken(cleartext),
  };
}

export function hashToken(cleartext: string): string {
  return createHash("sha256").update(cleartext).digest("hex");
}

export function isWellFormedToken(value: string): boolean {
  return /^nat_[a-f0-9]{32}$/.test(value);
}
