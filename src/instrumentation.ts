export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    if ((process.env.JOB_RUNNER ?? "inline") === "inline") {
      const { startInlineRunner } = await import("./lib/server/jobs/runner");
      startInlineRunner();
    }
    // Render's free plan sleeps after 15 idle minutes; requests to the public URL keep it awake
    // (and background jobs running). Disable with KEEP_AWAKE=false.
    const publicUrl = process.env.RENDER_EXTERNAL_URL;
    if (publicUrl && process.env.KEEP_AWAKE !== "false") {
      const minutes = Math.max(1, Number(process.env.KEEP_AWAKE_MINUTES) || 10);
      const ping = () => fetch(new URL("/api/ping", publicUrl), { headers: { "User-Agent": "WebScoutAI-KeepAwake" } }).catch(() => {});
      setInterval(ping, minutes * 60_000).unref?.();
      console.log(`[keep-awake] pinging ${publicUrl}/api/ping every ${minutes} min`);
    }
  }
}
