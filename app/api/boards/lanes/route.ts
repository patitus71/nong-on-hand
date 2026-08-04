import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { boardId, name } = await req.json();
  if (!name?.trim()) return new Response('name required', { status: 400 });

  // ยืนยันว่า board เป็นของ user คนนี้
  const board = await prisma.board.findFirst({ where: { id: boardId, ownerId: user.id } });
  if (!board) return new Response('Forbidden', { status: 403 });

  const maxOrder = await prisma.lane.aggregate({ where: { boardId }, _max: { order: true } });

  const lane = await prisma.lane.create({
    data: { boardId, name: name.trim(), order: (maxOrder._max.order ?? -1) + 1 },
  });

  return Response.json(lane);
}
