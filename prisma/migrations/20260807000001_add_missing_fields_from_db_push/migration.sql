-- Fields added via prisma db push without migration files.
-- This migration reconstructs them so the shadow database can apply all migrations cleanly.

-- Squad: isFloatingPool
ALTER TABLE "Squad" ADD COLUMN IF NOT EXISTS "isFloatingPool" BOOLEAN NOT NULL DEFAULT false;

-- User: soft-delete
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Task: soft-delete, flag-for-deletion, completedAt
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "flaggedForDeletion" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletionFlagNote" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletionFlaggedById" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "deletionFlaggedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "Task" ADD CONSTRAINT "Task_deletionFlaggedById_fkey"
    FOREIGN KEY ("deletionFlaggedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Notification table
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedTaskId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_relatedTaskId_fkey"
    FOREIGN KEY ("relatedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
