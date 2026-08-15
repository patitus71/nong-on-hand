-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sprint_squadId_status_idx" ON "Sprint"("squadId", "status");

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable Task: add sprintId
ALTER TABLE "Task" ADD COLUMN "sprintId" TEXT;

-- CreateIndex
CREATE INDEX "Task_sprintId_idx" ON "Task"("sprintId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable TaskIssueLog: add sprint FK (column already exists as plain text, just add constraint)
-- sprintId column was added via db push previously as plain String with no FK
-- If it doesn't exist yet, add it; either way add the FK constraint
ALTER TABLE "TaskIssueLog" ADD COLUMN IF NOT EXISTS "sprintId" TEXT;

-- AddForeignKey
ALTER TABLE "TaskIssueLog" ADD CONSTRAINT "TaskIssueLog_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
