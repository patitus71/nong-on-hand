// lib/sprint.ts — Sprint helper utilities
import { prisma } from '@/lib/prisma';
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Returns the OPEN sprint for a squad, or null if none exists. */
export async function getOpenSprint(squadId: string) {
  return prisma.sprint.findFirst({
    where: { squadId, status: 'OPEN' },
    select: { id: true, name: true, startedAt: true },
  });
}

/** Returns true if no OPEN sprint exists for the squad (safe to open a new one). */
export async function canOpenNewSprint(squadId: string): Promise<boolean> {
  const existing = await prisma.sprint.findFirst({
    where: { squadId, status: 'OPEN' },
    select: { id: true },
  });
  return existing === null;
}

/** Count tasks in a sprint that are NOT in the Done lane (including tasks with no lane yet). Cancelled tasks don't count as unfinished work. */
export async function countUnfinishedTasks(sprintId: string): Promise<number> {
  return prisma.task.count({
    where: {
      sprintId,
      deletedAt: null,
      isCancelled: false,
      NOT: { lane: { name: 'Done' } },
    },
  });
}

/**
 * ดึงงานค้างของ squad (ยังไม่เสร็จ, ไม่ถูกลบ/cancel) ที่ยัง sprintId ชี้ไป sprint ที่ปิดแล้ว
 * เข้ามาที่ sprint ใหม่ — ใช้ทั้งตอน "เปิด Sprint ใหม่" แบบ manual และตอน "ปิด Sprint"
 * ที่เปิด sprint ใหม่ต่อทันที (รับ tx เข้ามาได้เพื่อรันในธุรกรรมเดียวกับการปิด/สร้าง sprint)
 */
export async function carryOverUnfinishedTasks(db: Db, squadId: string, newSprintId: string): Promise<number> {
  const result = await db.task.updateMany({
    where: {
      squadId,
      deletedAt: null,
      isCancelled: false,
      sprint: { status: 'CLOSED' },
      NOT: { lane: { name: 'Done' } },
    },
    data: { sprintId: newSprintId },
  });
  return result.count;
}

/** Duration in whole days between startedAt and closedAt. */
export function calcSprintDurationDays(startedAt: Date, closedAt: Date): number {
  return Math.round((closedAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24));
}
