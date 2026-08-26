import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { hasIssue, issueNote, resolutionNote, destination } = await req.json();

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true, squadId: true, laneId: true, assigneeId: true,
      lane: { select: { board: { select: { type: true, ownerId: true } } } },
    },
  });
  if (!task) return new Response('Not Found', { status: 404 });

  if (hasIssue) {
    // Flagging: create a new TaskIssueLog entry
    const [updated] = await prisma.$transaction([
      prisma.task.update({
        where: { id: params.taskId },
        data: { hasIssue: true, issueNote: issueNote ?? null },
      }),
      prisma.taskIssueLog.create({
        data: {
          taskId:     params.taskId,
          issueNote:  issueNote ?? '',
          flaggedById: user.id,
        },
      }),
    ]);
    revalidatePath('/my-board');
    revalidatePath('/squads/[squadId]', 'page');
    return Response.json(updated);
  } else {
    // Resolving: find latest open log and close it; move task to target lane.
    // destination='todo' (default) → To Do lane (normal flow)
    // destination='done' → Done lane directly, bypass review requirement intentionally
    const resolveDestination: 'todo' | 'done' = destination === 'done' ? 'done' : 'todo';

    const openLog = await prisma.taskIssueLog.findFirst({
      where: { taskId: params.taskId, resolvedAt: null },
      orderBy: { flaggedAt: 'desc' },
    });

    let targetLane: { id: string } | null = null;
    if (resolveDestination === 'done') {
      // Done lane: bypass review check — resolutionNote serves as evidence
      if (task.squadId) {
        targetLane = await prisma.lane.findFirst({
          where: { name: 'Done', board: { type: 'SQUAD', owner: { squadId: task.squadId } } },
          select: { id: true },
        });
      } else {
        const ownerId = task.assigneeId ?? user.id;
        targetLane = await prisma.lane.findFirst({
          where: { name: 'Done', board: { type: 'PERSONAL', ownerId } },
          select: { id: true },
        });
      }
    } else {
      // Default: return to To Do lane
      if (task.squadId) {
        targetLane = await prisma.lane.findFirst({
          where: { name: 'To do', board: { type: 'SQUAD', owner: { squadId: task.squadId } } },
          select: { id: true },
        });
      } else {
        const ownerId = task.assigneeId ?? user.id;
        targetLane = await prisma.lane.findFirst({
          where: { name: 'To Do', board: { type: 'PERSONAL', ownerId } },
          select: { id: true },
        });
      }
    }

    const ops: any[] = [
      prisma.task.update({
        where: { id: params.taskId },
        data: {
          hasIssue:  false,
          issueNote: null,
          ...(targetLane ? { laneId: targetLane.id } : {}),
        },
      }),
    ];

    if (openLog) {
      ops.push(
        prisma.taskIssueLog.update({
          where: { id: openLog.id },
          data: {
            resolutionNote: resolutionNote ?? null,
            resolvedById:   user.id,
            resolvedAt:     new Date(),
          },
        }),
      );
    }

    const [updated] = await prisma.$transaction(ops);
    revalidatePath('/my-board');
    revalidatePath('/squads/[squadId]', 'page');
    return Response.json(updated);
  }
}
