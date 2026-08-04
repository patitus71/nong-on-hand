-- เพิ่มคอลัมน์ estimatedHours ก่อน (nullable) แล้วแปลงข้อมูลเก่า
ALTER TABLE "Task" ADD COLUMN "estimatedHours" DOUBLE PRECISION;

-- แปลงค่าจากนาทีเป็นชั่วโมง (หาร 60)
UPDATE "Task" SET "estimatedHours" = "estimatedMinutes"::float / 60.0 WHERE "estimatedMinutes" IS NOT NULL;

-- เพิ่ม dueDate
ALTER TABLE "Task" ADD COLUMN "dueDate" TIMESTAMP(3);

-- ลบคอลัมน์เก่า
ALTER TABLE "Task" DROP COLUMN "estimatedMinutes";
