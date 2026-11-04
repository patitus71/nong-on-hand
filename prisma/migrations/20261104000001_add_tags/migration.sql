-- Tag (Epic / Story / อื่นๆ) ใช้ร่วมทุก Squad + ตารางเชื่อม TaskTag (1 task ติดได้หลาย Tag)
-- เป็นตารางใหม่ล้วน — ไม่แตะคอลัมน์/ข้อมูลเดิมของ Task
-- CreateEnum
CREATE TYPE "TagKind" AS ENUM ('EPIC', 'STORY', 'OTHER');

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TagKind" NOT NULL DEFAULT 'OTHER',
    "url" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("taskId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_kind_key" ON "Tag"("name", "kind");

-- CreateIndex
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

