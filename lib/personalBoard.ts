import { prisma } from '@/lib/prisma';

export const PERSONAL_LANE_DEFAULTS = [
  { name: 'To Do',       order: 0 },
  { name: 'In Progress', order: 1 },
  { name: 'Review',      order: 2 },
  { name: 'Done',        order: 3 },
  { name: 'Cancel',      order: 4 },
];

// Lane name → personal lane name.
// Covers squad lane names AND personal lane names (tasks can end up in other users' personal boards).
export const SQ_TO_PERSONAL_LANE: Record<string, string> = {
  'To do':      'To Do',        // squad board
  'In progress': 'In Progress', // squad board
  'Done':       'Done',         // both
  'มีปัญหา':   'To Do',        // squad board physical lane → put in To Do (hasIssue=true moves it to issue section)
  'To Do':      'To Do',        // personal board (other user)
  'In Progress': 'In Progress', // personal board (other user)
  'Review':     'In Progress',  // personal board (other user) — treat as In Progress
};

// ticket ที่ Done หรือถูก cancel (เลน Cancel) แต่ sprint ที่มันสังกัดปิดไปแล้ว ถือว่าจบเรื่องแล้วจริงๆ
// ไม่ต้องตามหลอนอยู่ใน My Board อีก (ดูย้อนหลังได้ผ่าน export report ตามปกติ) — sprintId เป็น
// null ก็ยังโชว์ตามเดิม (ไม่เคยผูกกับ sprint ไหนเลย)
export function finishedInClosedSprintFilter() {
  return [
    { isCancelled: true, sprint: { status: 'CLOSED' as const } },
    { lane: { name: 'Done' }, sprint: { status: 'CLOSED' as const } },
  ];
}

/**
 * เลน "Cancel" เข้าได้ทางเดียวผ่าน resolve modal (destination=cancel) เท่านั้น —
 * user เก่าที่สร้าง personal board ไว้ก่อนฟีเจอร์นี้จะยังไม่มีเลนนี้ ฟังก์ชันนี้ backfill
 * ให้อัตโนมัติ (สร้างถ้ายังไม่มี) แล้วคืน lane id — เรียกจาก flag/route.ts (resolve-to-cancel)
 * โดยตรง กันเคส user ยังไม่เคยเปิด my-board มาก่อนหลัง deploy (ปกติ my-board/page.tsx
 * จะ backfill ให้ตั้งแต่โหลดหน้าอยู่แล้ว แต่กันไว้อีกชั้นเผื่อ)
 */
export async function ensurePersonalCancelLane(ownerId: string): Promise<string> {
  const board = await prisma.board.findFirst({
    where:  { type: 'PERSONAL', ownerId },
    select: { id: true },
  });
  if (!board) {
    throw new Error(`Personal board not found for user ${ownerId}`);
  }

  const existing = await prisma.lane.findFirst({
    where:  { boardId: board.id, name: 'Cancel' },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.lane.create({
    data: { boardId: board.id, name: 'Cancel', order: 4 },
  });
  return created.id;
}
