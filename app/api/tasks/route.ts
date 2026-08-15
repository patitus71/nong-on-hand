import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { title, laneId, squadId, assigneeId: assigneeParam, sprintId } = await req.json();
  if (!title?.trim()) return new Response('title required', { status: 400 });

  // หา order สูงสุดใน lane นั้น
  const maxOrder = laneId
    ? await prisma.task.aggregate({ where: { laneId }, _max: { order: true } })
    : { _max: { order: 0 } };

  // assigneeParam: undefined = ไม่ส่งมา (default เป็น creator), null = ไม่ assign ใคร (Squad Board)
  const resolvedAssigneeId = assigneeParam !== undefined ? (assigneeParam ?? null) : user.id;

  // If sprintId not provided, auto-assign the open sprint for the squad
  const targetSquadId = squadId ?? user.squadId ?? null;
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
