import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteTask, type SessionUser } from '@/lib/rbac';
import { buildTaskDeletionNotifications } from '@/lib/notifications';
import { revalidatePath } from 'next/cache';

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const body = await req.json() as { ids?: string[] };
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return new Response('ids required', { status: 400 });
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      title: true,
      squadId: true,
      source: true,
      pulledIntoBoardAt: true,
      flaggedForDeletion: true,
      assigneeId: true,
      deletionFlaggedById: true,
    },
  });

  for (const task of tasks) {
    if (!canDeleteTask(user, task)) {
      return new Response(`Forbidden — ไม่มีสิทธิ์ลบงาน "${task.title}"`, { status: 403 });
    }
  }

  const notifRows = tasks.flatMap(task =>
    buildTaskDeletionNotifications({
      id: task.id,
      title: task.title,
      assigneeId: task.assigneeId,
      deletionFlaggedById: task.deletionFlaggedById,
      deletedById: user.id,
    }),
  );

  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: { in: tasks.map(t => t.id) } },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    if (notifRows.length > 0) {
      await tx.notification.createMany({ data: notifRows });
    }
  });

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return NextResponse.json({ ok: true, deleted: tasks.length });
}
