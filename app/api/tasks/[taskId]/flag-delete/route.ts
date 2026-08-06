import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { SessionUser } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  if (user.role !== 'ADMIN' && user.role !== 'QA_LEAD') {
    return new Response('Forbidden', { status: 403 });
  }

  const body = await req.json() as { flaggedForDeletion: boolean; deletionFlagNote?: string };

  const task = await prisma.task.findUnique({
    where: { id: params.taskId, deletedAt: null },
    select: { id: true, squadId: true },
  });
  if (!task) return new Response('Not Found', { status: 404 });

  if (user.role === 'QA_LEAD' && task.squadId !== user.squadId) {
    return new Response('Forbidden — QA_LEAD ทำได้เฉพาะงานใน squad ตัวเอง', { status: 403 });
  }

  if (body.flaggedForDeletion) {
    if (!body.deletionFlagNote?.trim()) {
      return new Response('กรุณาระบุเหตุผลก่อน flag', { status: 400 });
    }
    await prisma.task.update({
      where: { id: task.id },
      data: {
        flaggedForDeletion:  true,
        deletionFlagNote:    body.deletionFlagNote.trim(),
        deletionFlaggedById: user.id,
        deletionFlaggedAt:   new Date(),
      },
    });
  } else {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        flaggedForDeletion:  false,
        deletionFlagNote:    null,
        deletionFlaggedById: null,
        deletionFlaggedAt:   null,
      },
    });
  }

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return Response.json({ ok: true });
}
