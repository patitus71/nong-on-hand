import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditSquadBoard, type SessionUser } from '@/lib/rbac';
import { shouldResetReviewApproval } from '@/lib/importTasks';
import { resolveTimerAction, startTimer, stopTimer } from '@/lib/autoTimeTracking';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { laneId, order, reviewerId } = await req.json() as { laneId: string; order?: number; reviewerId?: string | null };
  if (!laneId) return new Response('laneId required', { status: 400 });

  const [task, targetLane] = await Promise.all([
    prisma.task.findUnique({
      where:  { id: params.taskId },
      select: {
        id: true, squadId: true, assigneeId: true, reviewApprovedAt: true, requiresReview: true, isCancelled: true,
        lane: { select: { name: true } },
      },
    }),
    prisma.lane.findUnique({
      where:  { id: laneId },
      select: { name: true },
    }),
  ]);

  if (!task) return new Response('Not Found', { status: 404 });
  if (!targetLane) return new Response('Lane not found', { status: 404 });

  // ใครย้ายการ์ดนี้ได้: ADMIN เสมอ, เจ้าของงาน (my-board), หรือคนแก้ไข Squad Board ของ squad นั้นได้
  // (ADMIN/QA_LEAD เจ้าของ squad) — QA_MANAGER/QA_ENGINEER-นอกทีม/floating-pool ที่ไม่ใช่เจ้าของงาน
  // ต้องถูกบล็อก (floating pool ลากการ์ดของคนอื่นเองไม่ได้ตามสเปค 2.13)
  const canMove =
    user.role === 'ADMIN' ||
    task.assigneeId === user.id ||
    (!!task.squadId && canEditSquadBoard(user, task.squadId));
  if (!canMove) return new Response('Forbidden', { status: 403 });

  const oldLaneName = task.lane?.name ?? '';
  const newLaneName = targetLane.name;

  // เลน Cancel เข้าได้ทางเดียวผ่าน /api/tasks/[taskId]/flag เท่านั้น และเป็น terminal state
  if (task.isCancelled) {
    return new Response('งานนี้ถูกยกเลิกแล้ว ย้ายเลนต่อไม่ได้อีก', { status: 403 });
  }
  if (newLaneName === 'Cancel') {
    return new Response('ย้ายเข้าเลน Cancel โดยตรงไม่ได้ — ต้องกด "จัดการปัญหานี้" แล้วเลือกปลายทาง Cancel เท่านั้น', { status: 403 });
  }

  // QA_ENGINEER moving squad task to Done requires review approval — ยกเว้นงานที่ตั้ง
  // requiresReview: false ไว้ (งานแยกที่ไม่จำเป็นต้อง review)
  if (task.squadId && task.requiresReview && user.role === 'QA_ENGINEER' && newLaneName === 'Done' && !task.reviewApprovedAt) {
    return new Response('ต้องรอ QA_LEAD approve review ก่อนจึงจะย้ายงานไป Done ได้', { status: 403 });
  }

  const resetApproval  = shouldResetReviewApproval(oldLaneName, newLaneName);
  const enteringDone   = newLaneName === 'Done';

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      laneId,
      order: order ?? 0,
      ...(resetApproval ? {
        reviewApprovedAt:   null,
        reviewApprovedById: null,
        reviewerId:         reviewerId !== undefined ? reviewerId : null,
      } : {}),
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
