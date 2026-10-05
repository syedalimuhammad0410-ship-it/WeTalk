export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.JOB_RUNNER ?? "inline") === "inline" && process.env.NODE_ENV === "production") {
    const { startInlineRunner } = await import("./lib/server/jobs/runner");
    startInlineRunner();
  }
}
