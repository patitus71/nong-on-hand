import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canPullIntoBoard, canAssignTaskTo } from '@/lib/importTasks';
import { ensureSquadBoard } from '@/lib/squadBoard';
import { sendLineGroupMessageWithMention, MentionContext, thaiDate } from '@/lib/lineNotify';

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

  // LINE notification — ส่งเฉพาะถ้า pull-in มาพร้อม assignee
  if (assigneeId) {
    void (async () => {
      try {
        const [assignee, squad] = await Promise.all([
          prisma.user.findUnique({
            where:  { id: assigneeId },
            select: { name: true, lineUserId: true, lineDisplayName: true },
          }),
          prisma.squad.findUnique({
            where:  { id: targetSquadId },
            select: { name: true, lineGroupId: true },
          }),
        ]);

        if (!squad?.lineGroupId || !assignee) return;

        // สร้าง Notification ในแอปสำหรับ assignee
        await prisma.notification.create({
          data: {
            userId:        assigneeId,
            message:       `งาน "${updated.title}" ถูกมอบหมายให้คุณ`,
            relatedTaskId: updated.id,
          },
        });

        const dueDateStr = updated.dueDate ? thaiDate(updated.dueDate) : 'ไม่ระบุ';

        const ctx = new MentionContext();
        const mention = ctx.slot(assignee.lineDisplayName ?? assignee.name, assignee.lineUserId);
        const text = [
          `📌 ${mention} ได้รับมอบหมายงานใหม่`,
          `งาน: ${updated.title}`,
          `Squad: ${squad.name}`,
          `มอบหมายโดย: ${user.name}`,
          `กำหนดเสร็จ: ${dueDateStr}`,
        ].join('\n');
        await sendLineGroupMessageWithMention(squad.lineGroupId, text, ctx);
      } catch (err) {
        console.error('[pull-in] LINE notification error:', err);
      }
    })();
  }

  return Response.json(updated);
}
