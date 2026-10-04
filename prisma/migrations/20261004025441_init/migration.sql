-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'RESEARCHED', 'HIGH_OPPORTUNITY', 'CONTACTED', 'RESPONDED', 'AI_RESPONSE_READY', 'INTERESTED', 'FOLLOW_UP', 'MEETING', 'PROPOSAL', 'WON', 'LOST', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNKNOWN', 'NO_WEBSITE', 'WEBSITE_FOUND', 'WEBSITE_UNAVAILABLE', 'WEBSITE_BLOCKED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "WebsiteClass" AS ENUM ('NO_WEBSITE', 'OUTDATED', 'SINGLE_PAGE', 'BROKEN', 'INCOMPLETE', 'BASIC', 'MODERN', 'STRONG', 'EXCELLENT', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "BusinessSource" AS ENUM ('GOOGLE_PLACES', 'MANUAL', 'CSV_IMPORT', 'DEMO');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DISCOVERY', 'WEBSITE_AUDIT', 'PROMPT_GENERATION', 'OUTREACH_GENERATION', 'EMAIL_SYNC', 'INBOUND_ANALYSIS', 'FOLLOW_UP_DISPATCH', 'BULK_ACTION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('ANTHROPIC', 'GOOGLE_PLACES');

-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'POSTMARK', 'SANDBOX');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'FAILED', 'RECEIVED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('OUTREACH', 'FOLLOW_UP', 'REPLY', 'AI_REPLY', 'INBOUND');

-- CreateEnum
CREATE TYPE "Intent" AS ENUM ('INTERESTED', 'QUESTION', 'PRICING', 'REQUEST_FOR_MEETING', 'REQUEST_FOR_PHONE_CALL', 'NOT_INTERESTED', 'UNSUBSCRIBE', 'CONFUSED', 'COMPLAINT', 'LEGAL', 'PAYMENT', 'SPAM', 'AUTO_REPLY', 'OTHER');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'APPROVED', 'SENT', 'AUTO_SENT', 'REJECTED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResponseMode" AS ENUM ('MANUAL', 'APPROVAL_REQUIRED', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'PENDING_APPROVAL', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('OUTREACH', 'FOLLOW_UP', 'REPLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "avatarUrl" TEXT,
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "themePreference" TEXT NOT NULL DEFAULT 'system',
    "lastWorkspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT '',
    "senderName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "website" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "targetBusinesses" TEXT NOT NULL DEFAULT '',
    "serviceAreas" TEXT NOT NULL DEFAULT '',
    "typicalFeatures" TEXT NOT NULL DEFAULT '',
    "pricingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pricingDetails" TEXT NOT NULL DEFAULT '',
    "meetingLink" TEXT NOT NULL DEFAULT '',
    "brandVoice" TEXT NOT NULL DEFAULT '',
    "permittedClaims" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "aiWebsiteAnalysis" BOOLEAN NOT NULL DEFAULT true,
    "aiPromptGeneration" BOOLEAN NOT NULL DEFAULT true,
    "aiOutreachGeneration" BOOLEAN NOT NULL DEFAULT true,
    "aiResponseAnalysis" BOOLEAN NOT NULL DEFAULT true,
    "aiResponseDrafting" BOOLEAN NOT NULL DEFAULT true,
    "automaticReplies" BOOLEAN NOT NULL DEFAULT false,
    "automaticFollowUps" BOOLEAN NOT NULL DEFAULT false,
    "responseMode" "ResponseMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    "autoReplyMinConfidence" INTEGER NOT NULL DEFAULT 90,
    "humanReviewBelowConfidence" INTEGER NOT NULL DEFAULT 70,
    "aiModel" TEXT NOT NULL DEFAULT 'claude-opus-5-5',
    "aiEffort" TEXT NOT NULL DEFAULT 'medium',
    "responseTone" TEXT NOT NULL DEFAULT 'Professional',
    "maxResponseWords" INTEGER NOT NULL DEFAULT 180,
    "promptBehavior" TEXT NOT NULL DEFAULT '',
    "requireSendConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "followUpDays" INTEGER[] DEFAULT ARRAY[4, 10]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "maxEmailsPerDay" INTEGER NOT NULL DEFAULT 40,
    "maxEmailsPerHour" INTEGER NOT NULL DEFAULT 10,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 2,
    "minMinutesBetweenSends" INTEGER NOT NULL DEFAULT 2,
    "minDaysBetweenContacts" INTEGER NOT NULL DEFAULT 3,
    "includeUnsubscribeFooter" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeText" TEXT NOT NULL DEFAULT 'If you''d prefer not to hear from me again, just reply "unsubscribe" and I won''t contact you further.',
    "physicalAddress" TEXT NOT NULL DEFAULT '',
    "aiDisclosureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiDisclosureText" TEXT NOT NULL DEFAULT 'This message was drafted with AI assistance and reviewed by our team.',
    "blockFreeEmailDomains" BOOLEAN NOT NULL DEFAULT false,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT NOT NULL DEFAULT '',
    "signature" TEXT NOT NULL DEFAULT '',
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "apiTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "inboundTokenHash" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "syncCursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" TEXT,
    "businessType" TEXT,
    "businessTypeConfidence" INTEGER,
    "address" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "website" TEXT,
    "websiteDomain" TEXT,
    "email" TEXT,
    "emailSource" TEXT,
    "socialLinks" JSONB NOT NULL DEFAULT '{}',
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "hours" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "googleMapsUrl" TEXT,
    "operationalStatus" TEXT,
    "source" "BusinessSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "sourceFetchedAt" TIMESTAMP(3),
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "websiteClass" "WebsiteClass",
    "websiteScore" INTEGER,
    "opportunityScore" INTEGER,
    "leadScore" INTEGER,
    "lastIntent" "Intent",
    "assignedToId" TEXT,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "doNotContactAt" TIMESTAMP(3),
    "doNotContactReason" TEXT,
    "aiPaused" BOOLEAN NOT NULL DEFAULT false,
    "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastContactedAt" TIMESTAMP(3),
    "lastResponseAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "source" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStatusChange" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus" NOT NULL,
    "changedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "url" TEXT,
    "finalUrl" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "classification" "WebsiteClass",
    "overallScore" INTEGER,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "scoreBreakdown" JSONB NOT NULL DEFAULT '{}',
    "extracted" JSONB NOT NULL DEFAULT '{}',
    "pages" JSONB NOT NULL DEFAULT '[]',
    "performance" JSONB,
    "summary" TEXT,
    "aiSummary" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteFinding" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidence" TEXT,

    CONSTRAINT "WebsiteFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "auditId" TEXT,
    "score" INTEGER NOT NULL,
    "businessType" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "recommendedFeatures" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedPrompt" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "qualityScore" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "note" TEXT,
    "generator" TEXT NOT NULL,
    "qualityScore" INTEGER,
    "qualityBreakdown" JSONB,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL DEFAULT 'OUTREACH',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "searchSettings" JSONB NOT NULL DEFAULT '{}',
    "templateId" TEXT,
    "promptStrategy" TEXT NOT NULL DEFAULT '',
    "followUpDays" INTEGER[] DEFAULT ARRAY[4, 10]::INTEGER[],
    "followUpMode" TEXT NOT NULL DEFAULT 'APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "emailAccountId" TEXT,
    "subject" TEXT NOT NULL,
    "counterpartEmail" TEXT NOT NULL,
    "providerThreadId" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDirection" "MessageDirection",
    "lastIntent" "Intent",
    "lastConfidence" INTEGER,
    "needsHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "isHot" BOOLEAN NOT NULL DEFAULT false,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "businessId" TEXT,
    "emailAccountId" TEXT,
    "campaignId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "providerMessageId" TEXT,
    "rfcMessageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT,
    "providerThreadId" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "sentById" TEXT,
    "error" TEXT,
    "intent" "Intent",
    "confidence" INTEGER,
    "analysis" JSONB,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResponseDraft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT,
    "inboundMessageId" TEXT,
    "intent" "Intent" NOT NULL,
    "secondaryIntents" "Intent"[] DEFAULT ARRAY[]::"Intent"[],
    "confidence" INTEGER NOT NULL,
    "leadScore" INTEGER,
    "recommendedAction" TEXT NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingInfo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiResponseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT,
    "conversationId" TEXT,
    "step" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "subject" TEXT,
    "body" TEXT,
    "cancelReason" TEXT,
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTag" (
    "businessId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadTag_pkey" PRIMARY KEY ("businessId","tagId")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "businessId" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "label" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_workspaceId_idx" ON "Invitation"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_workspaceId_key" ON "CompanyProfile"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationSettings_workspaceId_key" ON "AutomationSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceSettings_workspaceId_key" ON "ComplianceSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_workspaceId_provider_key" ON "IntegrationCredential"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_inboundTokenHash_key" ON "EmailAccount"("inboundTokenHash");

-- CreateIndex
CREATE INDEX "EmailAccount_workspaceId_idx" ON "EmailAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_workspaceId_value_key" ON "SuppressionEntry"("workspaceId", "value");

-- CreateIndex
CREATE INDEX "Business_workspaceId_status_idx" ON "Business"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Business_workspaceId_normalizedName_idx" ON "Business"("workspaceId", "normalizedName");

-- CreateIndex
CREATE INDEX "Business_workspaceId_normalizedPhone_idx" ON "Business"("workspaceId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "Business_workspaceId_websiteDomain_idx" ON "Business"("workspaceId", "websiteDomain");

-- CreateIndex
CREATE INDEX "Business_workspaceId_email_idx" ON "Business"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Business_workspaceId_opportunityScore_idx" ON "Business"("workspaceId", "opportunityScore");

-- CreateIndex
CREATE INDEX "Business_workspaceId_discoveredAt_idx" ON "Business"("workspaceId", "discoveredAt");

-- CreateIndex
CREATE INDEX "Business_workspaceId_city_idx" ON "Business"("workspaceId", "city");

-- CreateIndex
CREATE INDEX "Business_workspaceId_archived_idx" ON "Business"("workspaceId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "Business_workspaceId_source_sourceId_key" ON "Business"("workspaceId", "source", "sourceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_email_idx" ON "Contact"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Contact_businessId_idx" ON "Contact"("businessId");

-- CreateIndex
CREATE INDEX "LeadStatusChange_businessId_createdAt_idx" ON "LeadStatusChange"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_businessId_createdAt_idx" ON "WebsiteAudit"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_workspaceId_createdAt_idx" ON "WebsiteAudit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteFinding_auditId_idx" ON "WebsiteFinding"("auditId");

-- CreateIndex
CREATE INDEX "Opportunity_businessId_createdAt_idx" ON "Opportunity"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedPrompt_workspaceId_updatedAt_idx" ON "GeneratedPrompt"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "GeneratedPrompt_businessId_idx" ON "GeneratedPrompt"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_promptId_version_key" ON "PromptVersion"("promptId", "version");

-- CreateIndex
CREATE INDEX "EmailTemplate_workspaceId_idx" ON "EmailTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "Campaign_workspaceId_idx" ON "Campaign"("workspaceId");

-- CreateIndex
CREATE INDEX "CampaignLead_businessId_idx" ON "CampaignLead"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_businessId_key" ON "CampaignLead"("campaignId", "businessId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_providerThreadId_idx" ON "Conversation"("workspaceId", "providerThreadId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_counterpartEmail_idx" ON "Conversation"("workspaceId", "counterpartEmail");

-- CreateIndex
CREATE INDEX "Conversation_businessId_idx" ON "Conversation"("businessId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_rfcMessageId_idx" ON "EmailMessage"("workspaceId", "rfcMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_conversationId_createdAt_idx" ON "EmailMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_businessId_createdAt_idx" ON "EmailMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_direction_sentAt_idx" ON "EmailMessage"("workspaceId", "direction", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_status_idx" ON "EmailMessage"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_workspaceId_providerMessageId_key" ON "EmailMessage"("workspaceId", "providerMessageId");

-- CreateIndex
CREATE INDEX "AiResponseDraft_workspaceId_status_idx" ON "AiResponseDraft"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AiResponseDraft_conversationId_idx" ON "AiResponseDraft"("conversationId");

-- CreateIndex
CREATE INDEX "FollowUp_workspaceId_status_scheduledFor_idx" ON "FollowUp"("workspaceId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_idx" ON "FollowUp"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "LeadTag_tagId_idx" ON "LeadTag"("tagId");

-- CreateIndex
CREATE INDEX "Note_businessId_createdAt_idx" ON "Note"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Note_workspaceId_idx" ON "Note"("workspaceId");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_userId_readAt_idx" ON "Notification"("workspaceId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_workspaceId_createdAt_idx" ON "ActivityLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_businessId_createdAt_idx" ON "ActivityLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_workspaceId_createdAt_idx" ON "Job"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedFilter_workspaceId_idx" ON "SavedFilter"("workspaceId");

-- CreateIndex
CREATE INDEX "AiUsage_workspaceId_createdAt_idx" ON "AiUsage"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationSettings" ADD CONSTRAINT "AutomationSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSettings" ADD CONSTRAINT "ComplianceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusChange" ADD CONSTRAINT "LeadStatusChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusChange" ADD CONSTRAINT "LeadStatusChange_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteFinding" ADD CONSTRAINT "WebsiteFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPrompt" ADD CONSTRAINT "GeneratedPrompt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedPrompt" ADD CONSTRAINT "GeneratedPrompt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "GeneratedPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResponseDraft" ADD CONSTRAINT "AiResponseDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResponseDraft" ADD CONSTRAINT "AiResponseDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResponseDraft" ADD CONSTRAINT "AiResponseDraft_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTag" ADD CONSTRAINT "LeadTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
