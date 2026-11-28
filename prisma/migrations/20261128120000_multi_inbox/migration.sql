-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "dailyLimit" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "restUntil" TIMESTAMP(3),
ADD COLUMN     "sendingEnabled" BOOLEAN NOT NULL DEFAULT true;

