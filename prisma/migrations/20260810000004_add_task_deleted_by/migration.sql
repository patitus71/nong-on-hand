-- Task.deletedById: track who performed the soft-delete (used in Weekly Report "ลบโดย + Role")
ALTER TABLE "Task" ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Task" ADD CONSTRAINT "Task_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
