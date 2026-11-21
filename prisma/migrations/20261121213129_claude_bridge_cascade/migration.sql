-- AddForeignKey
ALTER TABLE "ClaudeTaskEvent" ADD CONSTRAINT "ClaudeTaskEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudeSubmission" ADD CONSTRAINT "ClaudeSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
