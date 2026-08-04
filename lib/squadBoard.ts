import { prisma } from '@/lib/prisma';

export const SQUAD_LANE_DEFAULTS = [
  { name: 'To do',      order: 0 },
  { name: 'In progress', order: 1 },
  { name: 'Done',       order: 2 },
  { name: 'มีปัญหา',   order: 3 },
];

export async function ensureSquadBoard(squadId: string, userId: string, squadName: string) {
  return prisma.$transaction(async tx => {
    let board = await tx.board.findFirst({
      where:   { type: 'SQUAD', owner: { squadId } },
      include: { lanes: { orderBy: { order: 'asc' } } },
    });

    if (!board) {
      return tx.board.create({
        data: {
          name:    `${squadName} Board`,
          type:    'SQUAD',
          ownerId: userId,
          lanes:   { create: SQUAD_LANE_DEFAULTS },
        },
        include: { lanes: { orderBy: { order: 'asc' } } },
      });
    }

    // Add any lanes that are missing (e.g. when defaults are expanded)
    const existingNames = new Set(board.lanes.map(l => l.name));
    const missing = SQUAD_LANE_DEFAULTS.filter(l => !existingNames.has(l.name));
    if (missing.length > 0) {
      await tx.lane.createMany({
        data: missing.map(l => ({ ...l, boardId: board!.id })),
      });
      return tx.board.findUnique({
        where:   { id: board.id },
        include: { lanes: { orderBy: { order: 'asc' } } },
      });
    }

    return board;
  });
}
