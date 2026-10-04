export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOB_RUNNER !== "external" && process.env.NODE_ENV !== "test") {
    const { startInlineRunner } = await import("./lib/server/jobs/runner");
    startInlineRunner();
  }
}
