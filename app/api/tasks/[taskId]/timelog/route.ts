import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';

export async function POST(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { normalHours, otHours, replace } = await req.json() as {
    normalHours: number;
    otHours?: number;
    replace?: boolean;
  };

  if (!normalHours || normalHours <= 0) {
    return new Response('normalHours ต้องมากกว่า 0', { status: 400 });
  }

  const task = await prisma.task.findUnique({ where: { id: params.taskId }, select: { id: true } });
  if (!task) return new Response('Not Found', { status: 404 });

  if (replace) {
    await prisma.timeLog.deleteMany({ where: { taskId: params.taskId } });
  }

  const normalMinutes = Math.round(normalHours * 60);
  const otMinutes     = otHours && otHours > 0 ? Math.round(otHours * 60) : 0;
  const now = new Date();

  const log = await prisma.timeLog.create({
    data: {
      taskId:        params.taskId,
      userId:        user.id,
      startAt:       now,
      endAt:         now,
      normalMinutes,
      otMinutes,
      source:        'MANUAL',
    },
  });

  return Response.json({
    id:            log.id,
    normalMinutes: log.normalMinutes,
    otMinutes:     log.otMinutes,
    startAt:       log.startAt.toISOString(),
    endAt:         log.endAt!.toISOString(),
  });
}

export async function DELETE(_req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const task = await prisma.task.findUnique({ where: { id: params.taskId }, select: { id: true } });
  if (!task) return new Response('Not Found', { status: 404 });

  const existing = await prisma.timeLog.findMany({
    where:  { taskId: params.taskId },
    select: { normalMinutes: true, otMinutes: true },
  });
  const totalNormalMin = existing.reduce((s, l) => s + (l.normalMinutes ?? 0), 0);
  const totalOtMin     = existing.reduce((s, l) => s + (l.otMinutes ?? 0), 0);

  const { count } = await prisma.timeLog.deleteMany({ where: { taskId: params.taskId } });

  const log = await prisma.taskLog.create({
    data: {
      taskId: params.taskId,
      userId: user.id,
      action: 'TIME_CLEARED',
      detail: JSON.stringify({ deletedCount: count, totalNormalMin, totalOtMin }),
    },
    include: { user: { select: { name: true } } },
  });

  return Response.json({
    deleted: count,
    taskLog: {
      id:        log.id,
      action:    log.action,
      detail:    log.detail,
      createdAt: log.createdAt.toISOString(),
      userName:  log.user.name,
    },
  });
}
