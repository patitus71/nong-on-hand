// lib/sprint.ts — Sprint helper utilities
import { prisma } from '@/lib/prisma';

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

/** Duration in whole days between startedAt and closedAt. */
export function calcSprintDurationDays(startedAt: Date, closedAt: Date): number {
  return Math.round((closedAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60 * 24));
}
