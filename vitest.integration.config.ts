import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.integration.test.ts"],
    setupFiles: ["src/__tests__/setup-integration.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests hit real services — run sequentially to avoid connection contention.
    pool: "forks",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
