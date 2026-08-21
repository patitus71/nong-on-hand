/**
 * prisma/recalc-timelogs.ts
 * Re-calculates normalMinutes + otMinutes for all closed AUTO TimeLogs
 * using the corrected 2-slot overlap logic in lib/timeCalc.ts.
 *
 * Run with:  npx tsx prisma/recalc-timelogs.ts
 *
 * Safe to re-run: it only touches AUTO rows where endAt IS NOT NULL.
 * MANUAL rows are skipped (their values were entered by the user directly).
 */

import { PrismaClient } from '@prisma/client';
import { calcWorkedTime } from '../lib/timeCalc';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.timeLog.findMany({
    where:  { source: 'AUTO', endAt: { not: null } },
    select: { id: true, startAt: true, endAt: true, normalMinutes: true, otMinutes: true },
  });

  console.log(`พบ AUTO TimeLog ที่ปิดแล้ว: ${logs.length} แถว`);
  if (logs.length === 0) { console.log('ไม่มีอะไรต้อง recalculate'); return; }

  let updated = 0;
  let skipped = 0;

  for (const log of logs) {
    const { normalMinutes, otMinutes } = calcWorkedTime(log.startAt, log.endAt!);

    if (normalMinutes === (log.normalMinutes ?? 0) && otMinutes === (log.otMinutes ?? 0)) {
      skipped++;
      continue;
    }

    await prisma.timeLog.update({
      where: { id: log.id },
      data:  { normalMinutes, otMinutes },
    });
    updated++;
    console.log(
      `  updated ${log.id} | ${log.startAt.toISOString()} → ${log.endAt!.toISOString()}`,
      `| normal: ${log.normalMinutes ?? '?'} → ${normalMinutes}`,
      `| OT: ${log.otMinutes ?? '?'} → ${otMinutes}`,
    );
  }

  console.log(`\nเสร็จสิ้น: updated ${updated}, skipped (ค่าเท่าเดิม) ${skipped}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
