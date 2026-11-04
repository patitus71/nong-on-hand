// lib/tagsServer.ts
// helper ฝั่ง server ของ Tag (ใช้ prisma) — แยกจาก lib/tags.ts เพื่อไม่ให้ prisma หลุดไป client bundle

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { TAG_SELECT, type TagKind } from '@/lib/tags';

type Db = Prisma.TransactionClient | typeof prisma;

/** "ticket" ที่นับ = task ที่ยังไม่ถูก soft-delete — ตรงกับที่ผู้ใช้เห็นบนบอร์ด/ตาราง */
export const ACTIVE_TASK_LINK: Prisma.TaskTagWhereInput = { task: { deletedAt: null } };

export const TAG_WITH_COUNT_SELECT = {
  ...TAG_SELECT,
  createdAt: true,
  updatedAt: true,
  _count: { select: { tasks: { where: ACTIVE_TASK_LINK } } },
} satisfies Prisma.TagSelect;

type TagWithCountRow = Prisma.TagGetPayload<{ select: typeof TAG_WITH_COUNT_SELECT }>;

export function toTagResponse(row: TagWithCountRow) {
  const { _count, ...rest } = row;
  return { ...rest, ticketCount: _count.tasks };
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * กันชื่อซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ ("payment revamp" = "Payment Revamp")
 * unique constraint ใน DB เป็นแบบตรงตัว — อันนี้เป็นด่านแรกเพื่อ UX, DB เป็นด่านสุดท้ายกัน race
 */
export async function findDuplicateTag(name: string, kind: TagKind, excludeId?: string) {
  return prisma.tag.findFirst({
    where: {
      kind,
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, isArchived: true },
  });
}

/**
 * เช็คว่า tagIds ติดให้ task ได้ไหม: ต้องมีอยู่จริง และไม่ archived
 * ยกเว้น tag ที่ task ติดอยู่แล้ว (`alreadyAttached`) — archived ก็ยังเก็บไว้ได้ (ไม่บังคับให้หลุด)
 * return ข้อความ error ภาษาไทย หรือ null ถ้าผ่าน
 */
export async function checkAttachableTagIds(
  db: Db,
  tagIds: string[],
  alreadyAttached: ReadonlySet<string> = new Set(),
): Promise<string | null> {
  const toCheck = tagIds.filter(id => !alreadyAttached.has(id));
  if (toCheck.length === 0) return null;
  const found = await db.tag.findMany({
    where: { id: { in: toCheck } },
    select: { id: true, name: true, isArchived: true },
  });
  if (found.length !== toCheck.length) return 'ไม่พบ Tag บางรายการ — อาจถูกลบไปแล้ว ลองรีเฟรชหน้า';
  const archived = found.filter(t => t.isArchived);
  if (archived.length > 0) {
    return `Tag "${archived.map(t => t.name).join('", "')}" ถูก Archive แล้ว — ติดเพิ่มไม่ได้`;
  }
  return null;
}

/** ใช้ตอนสร้าง task ใหม่ภายใน transaction เดียวกับ task.create */
export async function attachTagsToNewTask(db: Db, taskId: string, tagIds: string[]) {
  if (tagIds.length === 0) return;
  await db.taskTag.createMany({ data: tagIds.map(tagId => ({ taskId, tagId })), skipDuplicates: true });
}
