import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteTask, type SessionUser } from '@/lib/rbac';
import { buildTaskDeletionNotifications } from '@/lib/notifications';
import { revalidatePath } from 'next/cache';

export async function DELETE(
  _req: Request,
  { params }: { params: { taskId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId, deletedAt: null },
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

  if (!task) return new Response('Not Found', { status: 404 });

  if (!canDeleteTask(user, task)) {
    return new Response('Forbidden — ไม่มีสิทธิ์ลบงานนี้', { status: 403 });
  }

  const notifRows = buildTaskDeletionNotifications({
    id: task.id,
    title: task.title,
    assigneeId: task.assigneeId,
    deletionFlaggedById: task.deletionFlaggedById,
    deletedById: user.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: task.id }, data: { deletedAt: new Date(), deletedById: user.id } });
    if (notifRows.length > 0) {
      await tx.notification.createMany({ data: notifRows });
    }
  });

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return NextResponse.json({ ok: true });
}
