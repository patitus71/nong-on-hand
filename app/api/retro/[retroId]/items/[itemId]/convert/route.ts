import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { retroId: string; itemId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const item = await prisma.retroItem.findUnique({
    where:   { id: params.itemId },
    include: { retro: { select: { squadId: true } } },
  });
  if (!item) return new Response('Not Found', { status: 404 });
  if (item.linkedTaskId) return Response.json({ taskId: item.linkedTaskId }); // already converted

  const task = await prisma.task.create({
    data: {
      title:      item.content,
      squadId:    item.retro.squadId,
      assigneeId: item.ownerId ?? user.id,
      source:     'MANUAL',
    },
  });

  await prisma.retroItem.update({
    where: { id: params.itemId },
    data:  { linkedTaskId: task.id },
  });

  return Response.json({ taskId: task.id });
}
