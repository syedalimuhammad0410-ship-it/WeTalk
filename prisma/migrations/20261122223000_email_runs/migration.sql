-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'EMAIL_RUN';

-- CreateTable
CREATE TABLE "EmailRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "useAi" BOOLEAN NOT NULL DEFAULT true,
    "includeNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "writer" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "nextSendAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EmailRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "prompt" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "writer" TEXT,
    "messageId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EmailRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailRun_workspaceId_createdAt_idx" ON "EmailRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailRunItem_runId_position_idx" ON "EmailRunItem"("runId", "position");

-- CreateIndex
CREATE INDEX "EmailRunItem_businessId_idx" ON "EmailRunItem"("businessId");

-- AddForeignKey
ALTER TABLE "EmailRun" ADD CONSTRAINT "EmailRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailRunItem" ADD CONSTRAINT "EmailRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EmailRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailRunItem" ADD CONSTRAINT "EmailRunItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

