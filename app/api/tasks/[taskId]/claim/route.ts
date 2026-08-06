import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { assigneeId } = await req.json();
  if (!assigneeId) return new Response('assigneeId required', { status: 400 });

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, squadId: true, laneId: true },
  });
  if (!task) return new Response('Not Found', { status: 404 });
  if (!task.squadId) return new Response('Task has no squad', { status: 400 });

  // Verify assignee belongs to the same squad (ADMIN exempt)
  if (user.role !== 'ADMIN') {
    const assignee = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { squadId: true },
    });
    if (!assignee || assignee.squadId !== task.squadId) {
      return new Response('Invalid assignee', { status: 400 });
    }
  }

  // Find "To do" lane in the squad's SQUAD board — always land in To do, user drags to In progress themselves
  const todoLane = await prisma.lane.findFirst({
    where: {
      name: { in: ['To do', 'To Do'] },
      board: { type: 'SQUAD', owner: { squadId: task.squadId } },
    },
  });
  if (!todoLane) return new Response('Squad board not set up yet', { status: 400 });

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      assigneeId,
      laneId: todoLane.id,
      ...(!task.laneId ? { pulledIntoBoardAt: new Date() } : {}),
    },
  });

  return Response.json(updated);
}
