-- Per-sprint capacity override: ชม./คน/sprint นี้โดยเฉพาะ — null = ใช้ Squad.capacityHours (ค่า default)
ALTER TABLE "Sprint" ADD COLUMN "capacityHours" INTEGER;
