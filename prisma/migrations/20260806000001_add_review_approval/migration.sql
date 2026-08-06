-- เพิ่มฟิลด์ reviewApprovedAt และ reviewApprovedById สำหรับ Review Approval flow
ALTER TABLE "Task" ADD COLUMN "reviewApprovedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "reviewApprovedById" TEXT;

-- Foreign key: reviewApprovedById → User.id
ALTER TABLE "Task" ADD CONSTRAINT "Task_reviewApprovedById_fkey"
    FOREIGN KEY ("reviewApprovedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
