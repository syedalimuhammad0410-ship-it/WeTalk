-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "category" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_category_idx" ON "Conversation"("workspaceId", "category");

