-- AlterEnum
ALTER TYPE "BusinessSource" ADD VALUE 'OPENSTREETMAP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'DISCOVERY_RUN';
ALTER TYPE "JobType" ADD VALUE 'AUTOPROSPECT';
ALTER TYPE "JobType" ADD VALUE 'CONTACT_DISCOVERY';

-- AlterTable
ALTER TABLE "AutomationSettings" ADD COLUMN     "autoSendImpliedConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "automationPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contactDiscoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "discoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "eligibilityChecksEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailGenerationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "followUpSchedulingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "geoExpansionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inboxMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "opportunityScoringEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "outreachMode" TEXT NOT NULL DEFAULT 'APPROVAL',
ADD COLUMN     "outreachSendingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promptGenerationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "websiteAnalysisEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "classification" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "consentBasis" TEXT,
ADD COLUMN     "eligibility" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN     "eligibilityReason" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "mxValid" BOOLEAN,
ADD COLUMN     "sourceSnippet" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "verification" TEXT NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verificationNote" TEXT;

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "automationRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "locations" TEXT[],
    "queries" TEXT[],
    "providers" TEXT[],
    "target" INTEGER NOT NULL DEFAULT 200,
    "maxRequests" INTEGER NOT NULL DEFAULT 500,
    "options" JSONB NOT NULL DEFAULT '{}',
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryZone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "south" DOUBLE PRECISION NOT NULL,
    "west" DOUBLE PRECISION NOT NULL,
    "north" DOUBLE PRECISION NOT NULL,
    "east" DOUBLE PRECISION NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pageToken" TEXT,
    "pages" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySearchHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "cellKey" TEXT NOT NULL,
    "results" INTEGER NOT NULL,
    "saturated" BOOLEAN NOT NULL DEFAULT false,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryProviderSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyRequestLimit" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryProviderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "contactId" TEXT,
    "email" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "discoveryRunId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT NOT NULL DEFAULT 'DISCOVERY',
    "config" JSONB NOT NULL DEFAULT '{}',
    "counters" JSONB NOT NULL DEFAULT '{}',
    "aiRequests" INTEGER NOT NULL DEFAULT 0,
    "placesRequests" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "checkpointAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "contactsAt" TIMESTAMP(3),
    "auditAt" TIMESTAMP(3),
    "promptAt" TIMESTAMP(3),
    "draftAt" TIMESTAMP(3),
    "draftMessageId" TEXT,
    "emailsFound" INTEGER NOT NULL DEFAULT 0,
    "eligibility" TEXT,
    "skipReason" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachApproval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "businessId" TEXT,
    "email" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryRun_workspaceId_createdAt_idx" ON "DiscoveryRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryZone_runId_status_idx" ON "DiscoveryZone"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryZone_runId_provider_query_south_west_north_east_key" ON "DiscoveryZone"("runId", "provider", "query", "south", "west", "north", "east");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySearchHistory_workspaceId_provider_query_cellKey_key" ON "DiscoverySearchHistory"("workspaceId", "provider", "query", "cellKey");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryProviderSetting_workspaceId_provider_key" ON "DiscoveryProviderSetting"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderUsage_workspaceId_provider_day_key" ON "ProviderUsage"("workspaceId", "provider", "day");

-- CreateIndex
CREATE INDEX "ConsentRecord_workspaceId_email_idx" ON "ConsentRecord"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "ConsentRecord_businessId_idx" ON "ConsentRecord"("businessId");

-- CreateIndex
CREATE INDEX "AutomationRun_workspaceId_createdAt_idx" ON "AutomationRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationItem_runId_status_idx" ON "AutomationItem"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationItem_runId_businessId_key" ON "AutomationItem"("runId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachApproval_messageId_key" ON "OutreachApproval"("messageId");

-- CreateIndex
CREATE INDEX "OutreachApproval_workspaceId_decidedAt_idx" ON "OutreachApproval"("workspaceId", "decidedAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_eligibility_idx" ON "Contact"("workspaceId", "eligibility");

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryZone" ADD CONSTRAINT "DiscoveryZone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryZone" ADD CONSTRAINT "DiscoveryZone_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverySearchHistory" ADD CONSTRAINT "DiscoverySearchHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryProviderSetting" ADD CONSTRAINT "DiscoveryProviderSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationItem" ADD CONSTRAINT "AutomationItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationItem" ADD CONSTRAINT "AutomationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachApproval" ADD CONSTRAINT "OutreachApproval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Emails previously found by the website audit came from the business's own site.
UPDATE "Contact" SET "classification" = 'VERIFIED_PUBLIC', "verification" = 'UNVERIFIED' WHERE "source" ILIKE '%website%';

-- Row-level security: the app connects as the owning role; no direct client access.
ALTER TABLE "DiscoveryRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscoveryZone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscoverySearchHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscoveryProviderSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutreachApproval" ENABLE ROW LEVEL SECURITY;
