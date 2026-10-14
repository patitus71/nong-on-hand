-- เวลาที่การ์ดถูกย้ายเข้าเลน In Progress ล่าสุด — โชว์ "เข้า In Progress ตั้งแต่ ... · กี่วันแล้ว" บน My Board
-- งานที่อยู่ใน In Progress ก่อน migration นี้จะเป็น null (ไม่มีประวัติให้ backfill — updatedAt เปลี่ยนทุกครั้งที่ reorder)
ALTER TABLE "Task" ADD COLUMN "inProgressAt" TIMESTAMP(3);
