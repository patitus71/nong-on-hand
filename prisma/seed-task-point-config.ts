/**
 * seed-task-point-config.ts — seed ค่าเริ่มต้นของ TaskPointMapping + TaskTypeOption
 * (global config, ไม่ผูก squad — ตั้งค่าเดียวกันทุก squad) ตามค่าที่เคยใช้ใน
 * "Sprint Take Point Simulator" ตัวเดิมก่อนรวมเข้าระบบจริง
 *
 * รัน: npx tsx prisma/seed-task-point-config.ts
 * Idempotent — ถ้ามีข้อมูลอยู่แล้ว (ทั้งสองตารางไม่ว่าง) จะข้าม ไม่ insert ซ้ำ
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const POINT_MAPPING: { point: number; hours: number }[] = [
  { point: 0.5, hours: 2 },
  { point: 1,   hours: 4 },
  { point: 2,   hours: 8 },
  { point: 3,   hours: 16 },
  { point: 5,   hours: 24 },
  { point: 8,   hours: 40 },
  { point: 13,  hours: 80 },
];

const TASK_TYPES: string[] = [
  "[prep test data]",
  "[create tcm]",
  "[create test case]",
  "[review test case]",
  "[maintain test case]",
  "[execute test case]",
  "[review test result]",
  "[regression test]",
  "[smoke test]",
  "[support user]",
  "[automation][create automation script]",
  "[automation][maintain automation script]",
  "[automation][collect locator id]",
  "[automation][create new keyword]",
  "[automation][integrate workflow]",
  "[automation][integrate jenkins pipeline]",
  "[automation][poc][solution]",
  "[automation][review pr]",
  "[automation][run test on jenkins]",
  "[automation][demo automate script]",
  "[support others]",
];

async function main() {
  const [pointCount, typeCount] = await Promise.all([
    prisma.taskPointMapping.count(),
    prisma.taskTypeOption.count(),
  ]);

  if (pointCount === 0) {
    await prisma.taskPointMapping.createMany({ data: POINT_MAPPING });
    console.log(`✓ seeded ${POINT_MAPPING.length} TaskPointMapping rows`);
  } else {
    console.log(`- skip TaskPointMapping (มีอยู่แล้ว ${pointCount} แถว)`);
  }

  if (typeCount === 0) {
    await prisma.taskTypeOption.createMany({
      data: TASK_TYPES.map((label, order) => ({ label, order })),
    });
    console.log(`✓ seeded ${TASK_TYPES.length} TaskTypeOption rows`);
  } else {
    console.log(`- skip TaskTypeOption (มีอยู่แล้ว ${typeCount} แถว)`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
