import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Topbar from '@/components/Topbar';
import MyBoardClient from './MyBoardClient';

// Lane name → personal lane name.
// Covers squad lane names AND personal lane names (tasks can end up in other users' personal boards).
const SQ_TO_PERSONAL_LANE: Record<string, string> = {
  'To do':      'To Do',        // squad board
  'In progress': 'In Progress', // squad board
  'Done':       'Done',         // both
  'มีปัญหา':   'To Do',        // squad board physical lane → put in To Do (hasIssue=true moves it to issue section)
  'To Do':      'To Do',        // personal board (other user)
  'In Progress': 'In Progress', // personal board (other user)
  'Review':     'In Progress',  // personal board (other user) — treat as In Progress
};

export default async function MyBoardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;

  // หา board ส่วนตัว หรือสร้างใหม่อัตโนมัติ
  let board = await prisma.board.findFirst({
    where: { ownerId: user.id, type: 'PERSONAL' },
    include: {
      lanes: {
        orderBy: { order: 'asc' },
        include: {
          tasks: {
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            include: {
              squad:    { select: { name: true } },
              assignee: { select: { name: true } },
              timeLogs: { select: { normalMinutes: true, otMinutes: true } },
            },
          },
        },
      },
    },
  });

  if (!board) {
    board = await prisma.board.create({
      data: {
        name:    'My Board',
        type:    'PERSONAL',
        ownerId: user.id,
        lanes: {
          create: [
            { name: 'To Do',       order: 0 },
            { name: 'In Progress', order: 1 },
            { name: 'Review',      order: 2 },
            { name: 'Done',        order: 3 },
          ],
        },
      },
      include: {
        lanes: {
          orderBy: { order: 'asc' },
          include: { tasks: { include: { squad: true, assignee: true, timeLogs: true } } },
        },
      },
    });
  }

  // Squad tasks assigned to me that are NOT in my own personal board.
  // Includes tasks in squad board lanes AND tasks that ended up in other users' personal board lanes.
  const rawSquadTasks = await prisma.task.findMany({
    where: {
      assigneeId: user.id,
      squadId:    { not: null },
      laneId:     { not: null },
      NOT: { lane: { boardId: board.id } },
    },
    include: {
      lane:     { select: { name: true } },
      squad:    { select: { name: true } },
      timeLogs: { select: { normalMinutes: true, otMinutes: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Split squad tasks: those that map to a personal lane vs. "มีปัญหา" / unmapped
  const sqByPersonalLane = new Map<string, typeof rawSquadTasks>();
  const sqProblemTasks: { id: string; title: string; hasIssue: boolean; laneName: string; squadName: string; totalNormalMin: number; totalOtMin: number }[] = [];

  for (const t of rawSquadTasks) {
    const personalLaneName = SQ_TO_PERSONAL_LANE[t.lane!.name];
    if (personalLaneName) {
      const arr = sqByPersonalLane.get(personalLaneName) ?? [];
      arr.push(t);
      sqByPersonalLane.set(personalLaneName, arr);
    } else {
      sqProblemTasks.push({
        id:             t.id,
        title:          t.title,
        hasIssue:       t.hasIssue,
        laneName:       t.lane!.name,
        squadName:      t.squad!.name,
        totalNormalMin: t.timeLogs.reduce((s, l) => s + l.normalMinutes, 0),
        totalOtMin:     t.timeLogs.reduce((s, l) => s + l.otMinutes, 0),
      });
    }
  }

  // Merge personal tasks + squad tasks into each lane
  const lanes = board.lanes.map(l => ({
    id:   l.id,
    name: l.name,
    tasks: [
      ...l.tasks.map(t => ({
        id:             t.id,
        title:          t.title,
        hasIssue:       t.hasIssue,
        order:          t.order,
        squad:          t.squad ? { name: t.squad.name } : null,
        assignee:       t.assignee ? { name: t.assignee.name } : null,
        totalNormalMin: t.timeLogs.reduce((s, l) => s + l.normalMinutes, 0),
        totalOtMin:     t.timeLogs.reduce((s, l) => s + l.otMinutes, 0),
      })),
      // Squad tasks in the matching lane (show after personal tasks)
      ...(sqByPersonalLane.get(l.name) ?? []).map(t => ({
        id:             t.id,
        title:          t.title,
        hasIssue:       t.hasIssue,
        order:          9999,
        squad:          t.squad ? { name: t.squad.name } : null,
        assignee:       null,
        totalNormalMin: t.timeLogs.reduce((s, l) => s + l.normalMinutes, 0),
        totalOtMin:     t.timeLogs.reduce((s, l) => s + l.otMinutes, 0),
      })),
    ],
  }));

  return (
    <>
      <Topbar />
      <MyBoardClient
        boardId={board.id}
        initialLanes={lanes}
        userId={user.id}
        userSquadId={(user as any).squadId ?? null}
        squadTasks={sqProblemTasks}
        canEditLanes={['ADMIN', 'QA_LEAD'].includes(user.role)}
      />
    </>
  );
}
