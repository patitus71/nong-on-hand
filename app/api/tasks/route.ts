import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { title, laneId, squadId } = await req.json();
  if (!title?.trim()) return new Response('title required', { status: 400 });

  // หา order สูงสุดใน lane นั้น
  const maxOrder = laneId
    ? await prisma.task.aggregate({ where: { laneId }, _max: { order: true } })
    : { _max: { order: 0 } };

  const task = await prisma.task.create({
    data: {
      title:      title.trim(),
      laneId:     laneId ?? null,
      squadId:    squadId ?? user.squadId ?? null,
      assigneeId: user.id,
      order:      (maxOrder._max.order ?? -1) + 1,
    },
    include: {
      squad:    { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });

  return Response.json(task);
}
