import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { SessionUser } from '@/lib/rbac';
import { shouldResetReviewApproval } from '@/lib/importTasks';

// Personal lane name → squad lane name for tasks that belong to a squad.
// 'Review' is intentionally absent: tasks in personal Review lane keep the personal laneId
// so the Squad Board can derive 'Wait for review' status from lane.name === 'Review'.
const PERSONAL_TO_SQUAD: Record<string, string> = {
  'To Do':      'To do',
  'In Progress': 'In progress',
  'Done':       'Done',
};

// Batch-reorder tasks across one or more lanes in one transaction.
// Body: { items: { id, laneId, order }[] }
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { items } = await req.json() as {
    items: { id: string; laneId: string; order: number }[];
  };
  if (!Array.isArray(items) || items.length === 0) {
    return new Response('items required', { status: 400 });
  }

  const taskIds       = items.map(i => i.id);
  const targetLaneIds = Array.from(new Set(items.map(i => i.laneId)));

  // Fetch tasks — include current laneId and reviewApprovedAt for guards
  const tasksRaw = await prisma.task.findMany({
    where:  { id: { in: taskIds } },
    select: { id: true, squadId: true, laneId: true, reviewApprovedAt: true },
  });
  const taskById = new Map(tasksRaw.map(t => [t.id, t]));

  // Fetch all lane IDs we need: targets + current task lanes
  const currentLaneIds = tasksRaw.filter(t => t.laneId).map(t => t.laneId!);
  const allLaneIds = Array.from(new Set([...targetLaneIds, ...currentLaneIds]));

  const lanesRaw = await prisma.lane.findMany({
    where:  { id: { in: allLaneIds } },
    select: { id: true, name: true, board: { select: { type: true } } },
  });
  const laneById = new Map(lanesRaw.map(l => [l.id, l]));

  // Collect which (squadId, squadLaneName) pairs we need to resolve
  const needed = new Set<string>(); // `${squadId}:${squadLaneName}`
  for (const { id, laneId } of items) {
    const task = taskById.get(id);
    const lane = laneById.get(laneId);
    if (!task?.squadId || lane?.board.type !== 'PERSONAL') continue;
    const sqName = PERSONAL_TO_SQUAD[lane.name];
    if (sqName) needed.add(`${task.squadId}:${sqName}`);
  }

  // Fetch squad lanes in one query
  const squadLaneMap = new Map<string, string>(); // `${squadId}:${laneName}` → laneId
  if (needed.size > 0) {
    const uniqueSquadIds = Array.from(new Set(Array.from(needed).map(k => k.split(':')[0])));
    const squadLanes = await prisma.lane.findMany({
      where: {
        name:  { in: Object.values(PERSONAL_TO_SQUAD) },
        board: { type: 'SQUAD', owner: { squadId: { in: uniqueSquadIds } } },
      },
      select: {
        id:   true,
        name: true,
        board: { select: { owner: { select: { squadId: true } } } },
      },
    });
    for (const l of squadLanes) {
      const sqId = l.board.owner.squadId;
      if (sqId) squadLaneMap.set(`${sqId}:${l.name}`, l.id);
    }
  }

  // Resolve final laneId for each item and validate
  const approvalResets = new Set<string>(); // task IDs that need reviewApprovedAt cleared

  const resolved = items.map(({ id, laneId, order }) => {
    const task        = taskById.get(id);
    const targetLane  = laneById.get(laneId);
    const currentLane = task?.laneId ? laneById.get(task.laneId) : null;

    const oldLaneName = currentLane?.name ?? '';
    const newLaneName = targetLane?.name ?? '';

    if (shouldResetReviewApproval(oldLaneName, newLaneName)) {
      approvalResets.add(id);
    }

    if (!task?.squadId || targetLane?.board.type !== 'PERSONAL') {
      return { id, laneId, order };
    }

    const sqName = PERSONAL_TO_SQUAD[newLaneName];
    if (!sqName) {
      // No squad translation (e.g. 'Review' lane) — keep personal laneId
      return { id, laneId, order };
    }

    const sqLaneId = squadLaneMap.get(`${task.squadId}:${sqName}`);
    return { id, laneId: sqLaneId ?? laneId, order };
  });

  // Guard: QA_ENGINEER moving squad task to Done without review approval
  if (user.role === 'QA_ENGINEER') {
    for (const { id, laneId: resolvedLaneId } of resolved) {
      const task = taskById.get(id);
      if (!task?.squadId || task.reviewApprovedAt) continue;
      // Check if resolved laneId is the squad's 'Done' lane
      const squadDoneLaneId = squadLaneMap.get(`${task.squadId}:Done`);
      if (squadDoneLaneId && squadDoneLaneId === resolvedLaneId) {
        return new Response('ต้องรอ QA_LEAD approve review ก่อนจึงจะย้ายงานไป Done ได้', { status: 403 });
      }
    }
  }

  await prisma.$transaction(
    resolved.map(({ id, laneId, order }) =>
      prisma.task.update({
        where: { id },
        data:  {
          laneId,
          order,
          ...(approvalResets.has(id) ? { reviewApprovedAt: null, reviewApprovedById: null } : {}),
        },
      }),
    ),
  );

  revalidatePath('/my-board');
  revalidatePath('/squads/[squadId]', 'page');
  return Response.json({ ok: true });
}
