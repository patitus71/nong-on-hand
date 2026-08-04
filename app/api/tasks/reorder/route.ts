import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Personal lane name → squad lane name (for tasks with squadId)
const PERSONAL_TO_SQUAD: Record<string, string> = {
  'To Do':      'To do',
  'In Progress': 'In progress',
  'Review':     'In progress',
  'Done':       'Done',
};

// Batch-reorder tasks across one or more lanes in one transaction.
// Body: { items: { id, laneId, order }[] }
// For tasks that belong to a squad, personal laneIds are translated to squad laneIds
// so the Squad Board stays in sync.
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { items } = await req.json() as {
    items: { id: string; laneId: string; order: number }[];
  };
  if (!Array.isArray(items) || items.length === 0) {
    return new Response('items required', { status: 400 });
  }

  // Batch fetch tasks + target lanes to avoid N+1
  const taskIds      = items.map(i => i.id);
  const targetLaneIds = Array.from(new Set(items.map(i => i.laneId)));

  const [tasksRaw, lanesRaw] = await Promise.all([
    prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, squadId: true },
    }),
    prisma.lane.findMany({
      where: { id: { in: targetLaneIds } },
      select: { id: true, name: true, board: { select: { type: true } } },
    }),
  ]);

  const taskById = new Map(tasksRaw.map(t => [t.id, t]));
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

  // Fetch all required squad lanes in one query
  const squadLaneMap = new Map<string, string>(); // `${squadId}:${laneName}` → laneId
  if (needed.size > 0) {
    const uniqueSquadIds = Array.from(new Set(Array.from(needed).map(k => k.split(':')[0])));
    const squadLanes = await prisma.lane.findMany({
      where: {
        name: { in: Object.values(PERSONAL_TO_SQUAD) },
        board: { type: 'SQUAD', owner: { squadId: { in: uniqueSquadIds } } },
      },
      select: {
        id: true,
        name: true,
        board: { select: { owner: { select: { squadId: true } } } },
      },
    });
    for (const l of squadLanes) {
      const sqId = l.board.owner.squadId;
      if (sqId) squadLaneMap.set(`${sqId}:${l.name}`, l.id);
    }
  }

  // Resolve final laneId for each item
  const resolved = items.map(({ id, laneId, order }) => {
    const task = taskById.get(id);
    const lane = laneById.get(laneId);
    if (!task?.squadId || lane?.board.type !== 'PERSONAL') return { id, laneId, order };
    const sqName = PERSONAL_TO_SQUAD[lane.name];
    if (!sqName) return { id, laneId, order };
    const sqLaneId = squadLaneMap.get(`${task.squadId}:${sqName}`);
    return { id, laneId: sqLaneId ?? laneId, order };
  });

  await prisma.$transaction(
    resolved.map(({ id, laneId, order }) =>
      prisma.task.update({ where: { id }, data: { laneId, order } }),
    ),
  );

  revalidatePath('/my-board');
  revalidatePath('/squads/[squadId]', 'page');
  return Response.json({ ok: true });
}
