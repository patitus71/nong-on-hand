// lib/notifications.ts
// สร้าง Notification records เมื่อมีการลบงาน
// ใช้ภายใน API route เท่านั้น — ไม่ export ไปฝั่ง client

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type DeletedTaskInfo = {
  id: string;
  title: string;
  assigneeId: string | null;
  deletionFlaggedById: string | null;
  deletedById: string; // actor ที่กดลบ
};

/**
 * สร้าง Notification แจ้ง assignee และคนที่ flag งานให้ลบ (ถ้ามี)
 * เรียกหลัง soft-delete task สำเร็จ ก่อน revalidatePath
 * Returns array of Prisma createMany data สำหรับ insert ใน transaction เดียวกับ delete ก็ได้
 */
export function buildTaskDeletionNotifications(
  task: DeletedTaskInfo
): Array<{
  userId: string;
  message: string;
  relatedTaskId: string;
}> {
  const rows: Array<{ userId: string; message: string; relatedTaskId: string }> = [];
  const seen = new Set<string>();

  const addRow = (userId: string, message: string) => {
    if (!userId || seen.has(userId)) return;
    seen.add(userId);
    rows.push({ userId, message, relatedTaskId: task.id });
  };

  if (task.assigneeId && task.assigneeId !== task.deletedById) {
    addRow(task.assigneeId, `งาน "${task.title}" ที่คุณรับผิดชอบถูกลบออกจากระบบแล้ว`);
  }

  if (task.deletionFlaggedById && task.deletionFlaggedById !== task.deletedById) {
    addRow(
      task.deletionFlaggedById,
      `งาน "${task.title}" ที่คุณ flag ไว้ถูกลบออกจากระบบแล้ว`
    );
  }

  return rows;
}

/**
 * Insert notification rows via Prisma — เรียกใน API route หลัง delete
 */
export async function insertTaskDeletionNotifications(
  prismaClient: PrismaClient,
  task: DeletedTaskInfo
) {
  const rows = buildTaskDeletionNotifications(task);
  if (rows.length === 0) return;
  await prismaClient.notification.createMany({ data: rows });
}
