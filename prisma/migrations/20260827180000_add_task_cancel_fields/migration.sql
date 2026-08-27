-- AlterTable
ALTER TABLE "Task" ADD COLUMN "isCancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "cancelNote" TEXT;
