-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'EMAIL_SCHEDULE';

-- AlterTable
ALTER TABLE "EmailRun" ADD COLUMN     "gapSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EmailSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "perDay" INTEGER NOT NULL DEFAULT 40,
    "startTime" TEXT NOT NULL DEFAULT '09:30',
    "endTime" TEXT NOT NULL DEFAULT '16:30',
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT false,
    "searchMinutes" INTEGER NOT NULL DEFAULT 30,
    "locations" TEXT[],
    "categories" TEXT[],
    "maxRequests" INTEGER NOT NULL DEFAULT 40,
    "lastBatchDay" TEXT,
    "lastSearchDay" TEXT,
    "lastRunId" TEXT,
    "searchRunId" TEXT,
    "searchStartedAt" TIMESTAMP(3),
    "message" TEXT,
    "nextAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSchedule_workspaceId_key" ON "EmailSchedule"("workspaceId");

-- AddForeignKey
ALTER TABLE "EmailSchedule" ADD CONSTRAINT "EmailSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

