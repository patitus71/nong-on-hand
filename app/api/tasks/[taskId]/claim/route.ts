import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureSquadBoard } from '@/lib/squadBoard';
import { canAssignTaskOnSquadBoard, type SessionUser } from '@/lib/rbac';
import { canAssignTaskTo } from '@/lib/importTasks';

export async function POST(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser & { name: string };

  const { assigneeId } = await req.json();
  if (!assigneeId) return new Response('assigneeId required', { status: 400 });

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, squadId: true, laneId: true, isCancelled: true },
  });
  if (!task) return new Response('Not Found', { status: 404 });
  if (!task.squadId) return new Response('Task has no squad', { status: 400 });
  if (task.isCancelled) return new Response('งานนี้ถูกยกเลิกแล้ว claim ต่อไม่ได้อีก', { status: 403 });
  if (!canAssignTaskOnSquadBoard(user, task.squadId)) {
    return new Response('Forbidden', { status: 403 });
  }

  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { role: true, squadId: true },
  });
  if (!assignee || !canAssignTaskTo(user, assignee)) {
    return new Response('Invalid assignee', { status: 400 });
  }

  // Find "To do" lane in the squad's SQUAD board — auto-create board if it doesn't exist yet
  let todoLane = await prisma.lane.findFirst({
    where: {
      name: { in: ['To do', 'To Do'] },
      board: { type: 'SQUAD', owner: { squadId: task.squadId } },
    },
  });

  if (!todoLane) {
    const squad = await prisma.squad.findUnique({
      where:  { id: task.squadId },
      select: { name: true },
    });
    const board = await ensureSquadBoard(task.squadId, user.id, squad?.name ?? '');
    const lane = board?.lanes.find(l => l.name === 'To do');
    if (!lane) return new Response('Board setup error', { status: 500 });
    todoLane = lane;
  }

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      assigneeId,
      laneId: todoLane.id,
      ...(!task.laneId ? { pulledIntoBoardAt: new Date() } : {}),
    },
  });

  // สร้าง in-app notification สำหรับ assignee — ไม่ส่ง LINE message ตอน assign แล้ว
  // (เก็บเฉพาะ Standup/EOD/End-of-sprint บน LINE เพื่อไม่ให้เปลือง quota)
  void prisma.notification.create({
    data: {
      userId:        assigneeId,
      message:       `งาน "${updated.title}" ถูกมอบหมายให้คุณ`,
      relatedTaskId: updated.id,
    },
  }).catch(err => console.error('[claim] notification create error:', err));

  return Response.json(updated);
}
