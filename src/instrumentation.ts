export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runWorker } = await import("@/lib/graph/worker");
    const controller = new AbortController();
    process.on("SIGTERM", () => controller.abort());
    process.on("SIGINT", () => controller.abort());
    void runWorker(controller.signal);
  }
}
