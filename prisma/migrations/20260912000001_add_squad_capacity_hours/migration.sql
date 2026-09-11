-- Board Point Capacity handoff: capacityHours ต่อคนต่อ sprint, เก็บระดับ squad (ไม่ hardcode 80)
ALTER TABLE "Squad" ADD COLUMN "capacityHours" INTEGER NOT NULL DEFAULT 80;
