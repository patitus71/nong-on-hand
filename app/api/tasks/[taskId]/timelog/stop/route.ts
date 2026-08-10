import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { stopTimer } from '@/lib/autoTimeTracking';
import type { SessionUser } from '@/lib/rbac';

export async function POST(_req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const openLog = await prisma.timeLog.findFirst({
    where:  { taskId: params.taskId, userId: user.id, endAt: null },
    select: { id: true, startAt: true },
  });

  if (!openLog) return new Response('No active session', { status: 404 });

  await stopTimer(params.taskId, user.id);

  const closed = await prisma.timeLog.findUnique({
    where:  { id: openLog.id },
    select: { id: true, normalMinutes: true, otMinutes: true, startAt: true, endAt: true },
  });

  return Response.json({
    id:            closed!.id,
    normalMinutes: closed!.normalMinutes ?? 0,
    otMinutes:     closed!.otMinutes ?? 0,
    startAt:       closed!.startAt.toISOString(),
    endAt:         closed!.endAt!.toISOString(),
  });
}
