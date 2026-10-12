-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "filterReason" TEXT,
ADD COLUMN     "filtered" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_filtered_lastMessageAt_idx" ON "Conversation"("workspaceId", "filtered", "lastMessageAt");

