import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generatePersonalReportMarkdown } from '@/lib/personalReport';
import { SQ_TO_PERSONAL_LANE, finishedInClosedSprintFilter } from '@/lib/personalBoard';
import type { SessionUser } from '@/lib/rbac';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser & { name: string };

  const { searchParams } = new URL(req.url);
  const weekStartParam = searchParams.get('weekStart');
  const weekEndParam   = searchParams.get('weekEnd');
  if (!weekStartParam || !weekEndParam) {
    return new Response('weekStart and weekEnd required', { status: 400 });
  }

  const weekStart = new Date(weekStartParam);
  const weekEnd   = new Date(weekEndParam);
  weekEnd.setHours(23, 59, 59, 999);

  const board = await prisma.board.findFirst({
    where:   { ownerId: user.id, type: 'PERSONAL' },
    include: {
      lanes: {
        orderBy: { order: 'asc' },
        include: {
          tasks: {
            where:   { deletedAt: null },
            include: { timeLogs: { select: { normalMinutes: true, otMinutes: true } } },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  });

  const boardTasks =
    board?.lanes.flatMap(l =>
      l.tasks.map(t => ({
        id:             t.id,
        title:          t.title,
        laneName:       l.name,
        completedAt:    t.completedAt,
        totalNormalMin: t.timeLogs.reduce((s, log) => s + (log.normalMinutes ?? 0), 0),
        totalOtMin:     t.timeLogs.reduce((s, log) => s + (log.otMinutes ?? 0), 0),
      }))
    ) ?? [];

  // งาน squad ที่ถูก assign ให้ user นี้ แต่ยังไม่เคยถูกดึงเข้า personal board ของตัวเอง
  // (laneId ยังชี้ไป lane ของ squad board อยู่) — ต้องรวมเข้ามาด้วย ไม่งั้น report จะโชว์
  // "ยังไม่มีงานบนบอร์ด" ทั้งที่ my-board จริงๆ มีงานอยู่ (ดู app/my-board/page.tsx rawSquadTasks)
  const rawSquadTasks = board
    ? await prisma.task.findMany({
        where: {
          assigneeId: user.id,
          deletedAt:  null,
          squadId:    { not: null },
          laneId:     { not: null },
          NOT: { OR: [{ lane: { boardId: board.id } }, ...finishedInClosedSprintFilter()] },
        },
        include: { lane: { select: { name: true } }, timeLogs: { select: { normalMinutes: true, otMinutes: true } } },
      })
    : [];

  const squadTasks = rawSquadTasks
    .map(t => {
      const laneName = SQ_TO_PERSONAL_LANE[t.lane!.name];
      if (!laneName) return null;
      return {
        id:             t.id,
        title:          t.title,
        laneName,
        completedAt:    t.completedAt,
        totalNormalMin: t.timeLogs.reduce((s, log) => s + (log.normalMinutes ?? 0), 0),
        totalOtMin:     t.timeLogs.reduce((s, log) => s + (log.otMinutes ?? 0), 0),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const tasks = [...boardTasks, ...squadTasks];

  const markdown = generatePersonalReportMarkdown({
    userName: user.name,
    weekStart,
    weekEnd,
    tasks,
  });

  return new Response(markdown, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
