-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "providerSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");

