import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canApproveReview, type SessionUser } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';

export async function PATCH(
  _req: Request,
  { params }: { params: { taskId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const task = await prisma.task.findUnique({
    where:  { id: params.taskId, deletedAt: null },
    select: { id: true, squadId: true, reviewApprovedAt: true, reviewerId: true },
  });

  if (!task) return new Response('Not Found', { status: 404 });

  if (!task.squadId) {
    return new Response('งานนี้ไม่ผูกกับ squad ใด', { status: 400 });
  }

  const isAssignedReviewer = task.reviewerId === user.id;
  if (!canApproveReview(user, task.squadId) && !isAssignedReviewer) {
    return new Response('Forbidden — เฉพาะ ADMIN และ QA_LEAD ของ squad นี้เท่านั้น', { status: 403 });
  }

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      reviewApprovedAt:   new Date(),
      reviewApprovedById: user.id,
    },
    select: { id: true, reviewApprovedAt: true, reviewApprovedById: true },
  });

  revalidatePath('/squads/[squadId]', 'page');
  return Response.json(updated);
}
