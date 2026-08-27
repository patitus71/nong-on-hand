// lib/autoTimeTracking.ts
// จัดการ auto time tracking (source: 'AUTO' ใน TimeLog) — เรียกจาก API route
// เท่านั้น ไม่ใช้ฝั่ง client โดยตรง ปัจจุบันถูกเรียกจาก:
//   - app/api/tasks/[taskId]/timelog/start, /timelog/stop (ปุ่ม start/stop timer manual)
//   - app/api/tasks/[taskId]/move (unused — ไม่มี client เรียก route นี้แล้ว)
// การลากการ์ดใน my-board (MyBoardClient) ไม่เรียกฟังก์ชันนี้โดยตรงแล้ว ตั้งแต่
// AUTO_TIMER_ON_DRAG ถูกปิด (ดูคอมเมนต์ที่ MyBoardClient.tsx) — เก็บไว้เผื่อใช้อนาคต

import { prisma } from '@/lib/prisma';
import { calcWorkedTime } from '@/lib/timeCalc';

export type TimerAction = 'start' | 'stop' | 'none';

const IN_PROGRESS = 'In Progress';

/**
 * ตัดสินว่าการย้ายเลนครั้งนี้ต้องทำอะไรกับ timer
 * start : ลากเข้า In Progress (จากเลนอื่น)
 * stop  : ลากออกจาก In Progress (ไปเลนอื่น)
 * none  : ย้ายภายในเลนเดิม หรือไม่เกี่ยวกับ In Progress
 */
export function resolveTimerAction(oldLaneName: string, newLaneName: string): TimerAction {
  if (newLaneName === IN_PROGRESS && oldLaneName !== IN_PROGRESS) return 'start';
  if (oldLaneName === IN_PROGRESS && newLaneName !== IN_PROGRESS) return 'stop';
  return 'none';
}

/**
 * เริ่มนับเวลา — สร้าง TimeLog ใหม่ (endAt: null = session เปิด)
 * ปิด session เปิดค้างของ task+user เดียวกันก่อนเสมอ กันซ้อนกัน
 */
export async function startTimer(taskId: string, userId: string): Promise<void> {
  const openLog = await prisma.timeLog.findFirst({
    where:  { taskId, userId, endAt: null },
    select: { id: true, startAt: true },
  });

  if (openLog) {
    const { normalMinutes, otMinutes } = calcWorkedTime(openLog.startAt, new Date());
    await prisma.timeLog.update({
      where: { id: openLog.id },
      data:  { endAt: new Date(), normalMinutes, otMinutes },
    });
  }

  await prisma.timeLog.create({
    data: { taskId, userId, startAt: new Date(), source: 'AUTO' },
  });
}

/**
 * หยุดนับเวลา — หา session เปิดล่าสุด แล้ว update endAt + คำนวณเวลา
 */
export async function stopTimer(taskId: string, userId: string): Promise<void> {
  const openLog = await prisma.timeLog.findFirst({
    where:  { taskId, userId, endAt: null },
    select: { id: true, startAt: true },
  });

  if (!openLog) return;

  const now = new Date();
  const { normalMinutes, otMinutes } = calcWorkedTime(openLog.startAt, now);
  await prisma.timeLog.update({
    where: { id: openLog.id },
    data:  { endAt: now, normalMinutes, otMinutes },
  });
}

/**
 * รวม normalMinutes + otMinutes จากทุก session ที่ปิดแล้ว (endAt ≠ null)
 * ใช้แสดงยอดรวมบนการ์ดหรือ task detail
 */
export async function sumTimeLogs(
  taskId: string
): Promise<{ normalMinutes: number; otMinutes: number }> {
  const logs = await prisma.timeLog.findMany({
    where:  { taskId, endAt: { not: null } },
    select: { normalMinutes: true, otMinutes: true },
  });

  return logs.reduce<{ normalMinutes: number; otMinutes: number }>(
    (acc, log) => ({
      normalMinutes: acc.normalMinutes + (log.normalMinutes ?? 0),
      otMinutes:     acc.otMinutes + (log.otMinutes ?? 0),
    }),
    { normalMinutes: 0, otMinutes: 0 }
  );
}
