-- AlterTable: Add LINE fields to Squad
ALTER TABLE "Squad" ADD COLUMN "lineGroupId" TEXT;
ALTER TABLE "Squad" ADD COLUMN "eodReportRecipientEmails" TEXT;

-- AlterTable: Add LINE userId and email to User
ALTER TABLE "User" ADD COLUMN "lineUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
