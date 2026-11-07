-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "reference" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

-- CreateIndex
CREATE INDEX "BillingPayment_workspaceId_createdAt_idx" ON "BillingPayment"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Workspaces that existed before plans were introduced keep full access.
INSERT INTO "Subscription" ("id", "workspaceId", "plan", "cycle", "status", "priceCents", "currentPeriodStart", "currentPeriodEnd", "note", "createdAt", "updatedAt")
SELECT 'sub_' || "id", "id", 'UNLIMITED', 'YEARLY', 'ACTIVE', 0, now(), '2099-12-31', 'Included for existing workspaces', now(), now() FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingPayment" ENABLE ROW LEVEL SECURITY;
