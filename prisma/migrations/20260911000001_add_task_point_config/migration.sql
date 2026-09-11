-- Sprint Take Point Simulator merge: global (non-squad-scoped) config tables
-- for the import page, editable only from Admin Panel.

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "taskType" TEXT,
                    ADD COLUMN "taskPoint" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TaskPointMapping" (
    "id" TEXT NOT NULL,
    "point" DOUBLE PRECISION NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TaskPointMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTypeOption" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskTypeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskPointMapping_point_key" ON "TaskPointMapping"("point");

-- CreateIndex
CREATE INDEX "TaskTypeOption_order_idx" ON "TaskTypeOption"("order");

-- Seed data (default point mapping + task type list carried over from the standalone
-- Sprint Take Point Simulator) is inserted by prisma/seed-task-point-config.ts via
-- Prisma Client, not here — keeps id generation as normal app-level cuid().
