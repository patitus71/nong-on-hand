import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canCreateTask, canCreateTaskOnSquadBoard, type SessionUser } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { title, laneId, squadId, assigneeId: assigneeParam, sprintId } = await req.json();
  if (!title?.trim()) return new Response('title required', { status: 400 });

  // assigneeParam: undefined = ไม่ส่งมา (My Board create, default เป็น creator), key ปรากฏ (แม้เป็น
  // null) = Squad Board create — ใช้สัญญาณเดียวกันนี้แยกว่าต้องเช็คสิทธิ์ไหน (ดู resolvedAssigneeId ด้านล่าง)
  const targetSquadId = squadId ?? user.squadId ?? null;
  const isSquadBoardCreate = assigneeParam !== undefined;
  if (isSquadBoardCreate) {
    if (!targetSquadId || !canCreateTaskOnSquadBoard(user, targetSquadId)) {
      return new Response('Forbidden', { status: 403 });
    }
  } else if (!canCreateTask(user)) {
    return new Response('Forbidden', { status: 403 });
  }

  // หา order สูงสุดใน lane นั้น
  const maxOrder = laneId
    ? await prisma.task.aggregate({ where: { laneId }, _max: { order: true } })
    : { _max: { order: 0 } };

  // assigneeParam: undefined = ไม่ส่งมา (default เป็น creator), null = ไม่ assign ใคร (Squad Board)
  const resolvedAssigneeId = assigneeParam !== undefined ? (assigneeParam ?? null) : user.id;

  // If sprintId not provided, auto-assign the open sprint for the squad
  let resolvedSprintId = sprintId ?? null;
  if (!resolvedSprintId && targetSquadId) {
    const openSprint = await prisma.sprint.findFirst({
      where: { squadId: targetSquadId, status: 'OPEN' },
      select: { id: true },
    });
    resolvedSprintId = openSprint?.id ?? null;
  }

  const task = await prisma.task.create({
    data: {
      title:      title.trim(),
      laneId:     laneId ?? null,
      squadId:    targetSquadId,
      assigneeId: resolvedAssigneeId,
      sprintId:   resolvedSprintId,
      order:      (maxOrder._max.order ?? -1) + 1,
    },
    include: {
      squad:    { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });

  return Response.json(task);
}
