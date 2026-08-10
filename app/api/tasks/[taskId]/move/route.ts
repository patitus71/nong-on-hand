import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import { shouldResetReviewApproval } from '@/lib/importTasks';
import { resolveTimerAction, startTimer, stopTimer } from '@/lib/autoTimeTracking';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { laneId, order } = await req.json();
  if (!laneId) return new Response('laneId required', { status: 400 });

  const [task, targetLane] = await Promise.all([
    prisma.task.findUnique({
      where:  { id: params.taskId },
      select: { id: true, squadId: true, reviewApprovedAt: true, lane: { select: { name: true } } },
    }),
    prisma.lane.findUnique({
      where:  { id: laneId },
      select: { name: true },
    }),
  ]);

  if (!task) return new Response('Not Found', { status: 404 });
  if (!targetLane) return new Response('Lane not found', { status: 404 });

  const oldLaneName = task.lane?.name ?? '';
  const newLaneName = targetLane.name;

  // QA_ENGINEER moving squad task to Done requires review approval
  if (task.squadId && user.role === 'QA_ENGINEER' && newLaneName === 'Done' && !task.reviewApprovedAt) {
    return new Response('ต้องรอ QA_LEAD approve review ก่อนจึงจะย้ายงานไป Done ได้', { status: 403 });
  }

  const resetApproval  = shouldResetReviewApproval(oldLaneName, newLaneName);
  const enteringDone   = newLaneName === 'Done';

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      laneId,
      order: order ?? 0,
      ...(resetApproval ? { reviewApprovedAt: null, reviewApprovedById: null } : {}),
      ...(enteringDone   ? { completedAt: new Date() } : {}),
    },
  });

  // Auto time tracking — start/stop timer ตามชื่อเลน
  const timerAction = resolveTimerAction(oldLaneName, newLaneName);
  if (timerAction === 'start') {
    await startTimer(params.taskId, user.id);
  } else if (timerAction === 'stop') {
    await stopTimer(params.taskId, user.id);
  }

  return Response.json(updated);
}
