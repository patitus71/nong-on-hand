import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, { params }: { params: { laneId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const lane = await prisma.lane.findUnique({
    where: { id: params.laneId },
    include: { board: { select: { ownerId: true } }, _count: { select: { tasks: true } } },
  });
  if (!lane) return new Response('Not found', { status: 404 });
  if (lane.board.ownerId !== user.id) return new Response('Forbidden', { status: 403 });

  await prisma.lane.delete({ where: { id: params.laneId } });
  return Response.json({ ok: true, taskCount: lane._count.tasks });
}
