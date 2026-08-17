import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { canCreateTask, type SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import MyBoardClient from './MyBoardClient';

function computeAtRisk(
  totalMin: number,
  estimatedHours: number | null,
  plannedEndDate: Date | null,
  isDone: boolean,
): { isAtRisk: boolean; riskReason: string } {
  if (isDone) return { isAtRisk: false, riskReason: '' };
  const reasons: string[] = [];
  if (estimatedHours && totalMin > estimatedHours * 60) reasons.push('เวลาเกิน estimate แล้ว');
  if (plannedEndDate) {
    const d = Math.ceil((plannedEndDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (d <= 2) reasons.push(d <= 0 ? 'Sprint เลยกำหนดแล้ว' : `Sprint ปิดใน ${d} วัน`);
  }
  return { isAtRisk: reasons.length > 0, riskReason: reasons.join(' · ') };
}

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
  const session = await getSession();
  if (!session) redirect('/login');
  const user = session.user as SessionUser & { name: string };

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
              sprint:   { select: { plannedEndDate: true } },
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
          include: { tasks: { include: { squad: true, assignee: true, timeLogs: true, sprint: { select: { plannedEndDate: true } } } } },
        },
      },
    });
  }

  // Squad tasks assigned to me that are NOT in my own personal board.
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
      sprint:   { select: { plannedEndDate: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const sqByPersonalLane = new Map<string, typeof rawSquadTasks>();
  const sqProblemTasks: {
    id: string; title: string; hasIssue: boolean; laneName: string;
    squadName: string; totalNormalMin: number; totalOtMin: number;
  }[] = [];

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
        totalNormalMin: t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0), 0),
        totalOtMin:     t.timeLogs.reduce((s, l) => s + (l.otMinutes ?? 0), 0),
      });
    }
  }

  const lanes = board.lanes.map(l => ({
    id:   l.id,
    name: l.name,
    tasks: [
      ...l.tasks.map(t => {
        const totalNormalMin = t.timeLogs.reduce((s, lg) => s + (lg.normalMinutes ?? 0), 0);
        const totalOtMin     = t.timeLogs.reduce((s, lg) => s + (lg.otMinutes ?? 0), 0);
        const { isAtRisk, riskReason } = computeAtRisk(
          totalNormalMin + totalOtMin,
          t.estimatedHours ?? null,
          t.sprint?.plannedEndDate ?? null,
          l.name === 'Done',
        );
        return {
          id:               t.id,
          title:            t.title,
          hasIssue:         t.hasIssue,
          order:            t.order,
          reviewApprovedAt: t.reviewApprovedAt?.toISOString() ?? null,
          squad:            t.squad ? { name: t.squad.name } : null,
          assignee:         t.assignee ? { name: t.assignee.name } : null,
          totalNormalMin,
          totalOtMin,
          isAtRisk,
          riskReason,
        };
      }),
      ...(sqByPersonalLane.get(l.name) ?? []).map(t => {
        const totalNormalMin = t.timeLogs.reduce((s, lg) => s + (lg.normalMinutes ?? 0), 0);
        const totalOtMin     = t.timeLogs.reduce((s, lg) => s + (lg.otMinutes ?? 0), 0);
        const { isAtRisk, riskReason } = computeAtRisk(
          totalNormalMin + totalOtMin,
          t.estimatedHours ?? null,
          t.sprint?.plannedEndDate ?? null,
          l.name === 'Done',
        );
        return {
          id:               t.id,
          title:            t.title,
          hasIssue:         t.hasIssue,
          order:            9999,
          reviewApprovedAt: null,
          squad:            t.squad ? { name: t.squad.name } : null,
          assignee:         null,
          totalNormalMin,
          totalOtMin,
          isAtRisk,
          riskReason,
        };
      }),
    ],
  }));

  return (
    <>
      <Topbar />
      <MyBoardClient
        boardId={board.id}
        initialLanes={lanes}
        userId={user.id}
        userSquadId={user.squadId ?? null}
        squadTasks={sqProblemTasks}
        canEditLanes={user.role === 'ADMIN' || user.role === 'QA_LEAD'}
        canCreateTask={canCreateTask(user)}
      />
    </>
  );
}
