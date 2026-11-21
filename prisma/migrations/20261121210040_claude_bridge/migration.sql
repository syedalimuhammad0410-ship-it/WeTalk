-- AlterEnum
ALTER TYPE "BusinessSource" ADD VALUE 'CLAUDE_RESEARCH';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "ClaudeConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastClient" TEXT,
    "companionSeenAt" TIMESTAMP(3),
    "deviceName" TEXT,
    "platform" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaudeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaudeTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "connectionId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "error" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaudeTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaudeTaskEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "businessId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaudeTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaudeSubmission" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaudeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessEvidence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "taskId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'FACT',
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT,
    "confidence" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL DEFAULT 'CLAUDE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeConnection_tokenHash_key" ON "ClaudeConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "ClaudeConnection_workspaceId_idx" ON "ClaudeConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "ClaudeTask_workspaceId_status_idx" ON "ClaudeTask"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ClaudeTask_workspaceId_createdAt_idx" ON "ClaudeTask"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaudeTaskEvent_workspaceId_createdAt_idx" ON "ClaudeTaskEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaudeTaskEvent_taskId_createdAt_idx" ON "ClaudeTaskEvent"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClaudeSubmission_workspaceId_idempotencyKey_key" ON "ClaudeSubmission"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BusinessEvidence_businessId_field_idx" ON "BusinessEvidence"("businessId", "field");

-- CreateIndex
CREATE INDEX "BusinessEvidence_workspaceId_createdAt_idx" ON "BusinessEvidence"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaudeConnection" ADD CONSTRAINT "ClaudeConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudeTask" ADD CONSTRAINT "ClaudeTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaudeTaskEvent" ADD CONSTRAINT "ClaudeTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ClaudeTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessEvidence" ADD CONSTRAINT "BusinessEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessEvidence" ADD CONSTRAINT "BusinessEvidence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same as other tables: only the app role (owner) can read these.
ALTER TABLE "ClaudeConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaudeTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaudeTaskEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaudeSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusinessEvidence" ENABLE ROW LEVEL SECURITY;
