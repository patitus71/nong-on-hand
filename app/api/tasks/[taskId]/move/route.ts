import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { laneId, order } = await req.json();

  const task = await prisma.task.update({
    where: { id: params.taskId },
    data:  { laneId, order: order ?? 0 },
  });

  return Response.json(task);
}
