import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { startTimer } from '@/lib/autoTimeTracking';
import type { SessionUser } from '@/lib/rbac';

export async function POST(_req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const task = await prisma.task.findUnique({ where: { id: params.taskId }, select: { id: true } });
  if (!task) return new Response('Not Found', { status: 404 });

  await startTimer(params.taskId, user.id);

  const openLog = await prisma.timeLog.findFirst({
    where:  { taskId: params.taskId, userId: user.id, endAt: null },
    select: { id: true, startAt: true },
  });

  return Response.json({ id: openLog!.id, startAt: openLog!.startAt.toISOString() });
}
