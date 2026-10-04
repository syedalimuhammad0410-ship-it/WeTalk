/**
 * Standalone background worker. Use with JOB_RUNNER=external for multi-instance
 * deployments: `npm run worker`. Safe to run several copies (SKIP LOCKED claims).
 */
import { runnerLoop } from "../src/lib/server/jobs/runner";

console.log("[worker] WebScout AI background worker started");
void runnerLoop();
process.on("SIGTERM", () => process.exit(0));
