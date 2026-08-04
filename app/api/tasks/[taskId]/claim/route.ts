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

  // Find "In progress" lane in the squad's SQUAD board
  const inProgressLane = await prisma.lane.findFirst({
    where: {
      name: { in: ['In progress', 'In Progress'] },
      board: { type: 'SQUAD', owner: { squadId: task.squadId } },
    },
  });
  if (!inProgressLane) return new Response('Squad board not set up yet', { status: 400 });

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      assigneeId,
      laneId: inProgressLane.id,
      ...(!task.laneId ? { pulledIntoBoardAt: new Date() } : {}),
    },
  });

  return Response.json(updated);
}
