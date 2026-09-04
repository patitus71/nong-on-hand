import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canPullIntoBoard, canAssignTaskTo } from '@/lib/importTasks';
import { ensureSquadBoard } from '@/lib/squadBoard';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  if (!['ADMIN', 'QA_LEAD'].includes(user.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { estimatedHours, dueDate, assigneeId, sprintId } = await req.json();

  const task = await prisma.task.findUnique({ where: { id: params.taskId } });
  if (!task) return new Response('Not Found', { status: 404 });

  if (task.pulledIntoBoardAt) {
    return new Response('Task already pulled into board', { status: 400 });
  }
  if (task.isCancelled) {
    return new Response('งานนี้ถูกยกเลิกแล้ว ดึงเข้าบอร์ดต่อไม่ได้อีก', { status: 403 });
  }

  if (user.squadId && !canPullIntoBoard(task, user.squadId)) {
    return new Response('Forbidden: task belongs to another squad', { status: 403 });
  }

  if (assigneeId) {
    const assignee = await prisma.user.findUnique({
      where:  { id: assigneeId },
      select: { role: true, squadId: true },
    });
    if (!assignee || !canAssignTaskTo(user, assignee)) {
      return new Response('Invalid assignee', { status: 400 });
    }
  }

  // Validate sprintId if provided
  if (sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { status: true, squadId: true },
    });
    const targetSquadId2 = task.squadId ?? user.squadId;
    if (!sprint || sprint.status !== 'OPEN' || sprint.squadId !== targetSquadId2) {
      return new Response('Invalid or closed sprint', { status: 400 });
    }
  }

  // Auto-resolve the "To do" lane of the squad board — client never picks the lane
  const targetSquadId = task.squadId ?? user.squadId;
  if (!targetSquadId) return new Response('No squad for this task', { status: 400 });

  let todoLane = await prisma.lane.findFirst({
    where: {
      name:  'To do',
      board: { type: 'SQUAD', owner: { squadId: targetSquadId } },
    },
    select: { id: true },
  });

  if (!todoLane) {
    const squad = await prisma.squad.findUnique({
      where:  { id: targetSquadId },
      select: { name: true },
    });
    const board = await ensureSquadBoard(targetSquadId, user.id, squad?.name ?? '');
    const lane = board?.lanes.find(l => l.name === 'To do');
    if (!lane) return new Response('Board setup error', { status: 500 });
    todoLane = { id: lane.id };
  }

  const maxOrder = await prisma.task.aggregate({
    where: { laneId: todoLane.id },
    _max:  { order: true },
  });

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data:  {
      laneId:            todoLane.id,
      pulledIntoBoardAt: new Date(),
      estimatedHours:    estimatedHours ? Number(estimatedHours) : task.estimatedHours,
      dueDate:           dueDate ? new Date(dueDate) : null,
      assigneeId:        assigneeId || null,
      sprintId:          sprintId || null,
      order:             (maxOrder._max.order ?? -1) + 1,
    },
  });

  // สร้าง in-app notification สำหรับ assignee — ไม่ส่ง LINE message ตอน assign แล้ว
  // (เก็บเฉพาะ Standup/EOD/End-of-sprint บน LINE เพื่อไม่ให้เปลือง quota)
  if (assigneeId) {
    void prisma.notification.create({
      data: {
        userId:        assigneeId,
        message:       `งาน "${updated.title}" ถูกมอบหมายให้คุณ`,
        relatedTaskId: updated.id,
      },
    }).catch(err => console.error('[pull-in] notification create error:', err));
  }

  return Response.json(updated);
}
