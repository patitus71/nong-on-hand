import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { type SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import TasksClient from './TasksClient';

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const user = session.user as SessionUser & { name: string };

  const [tasks, squads, users, qaEngineers] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null },
      include: {
        squad:    { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        lane:     { select: { name: true } },
        timeLogs: { select: { normalMinutes: true, otMinutes: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.squad.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where:   { active: true, deletedAt: null },
      select:  { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // QA Engineers in user's squad for the pull-in modal assignee dropdown
    user.squadId
      ? prisma.user.findMany({
          where:   { role: 'QA_ENGINEER', squadId: user.squadId, active: true },
          select:  { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const rows = tasks.map(t => ({
    id:                  t.id,
    title:               t.title,
    hasIssue:            t.hasIssue,
    source:              t.source as 'MANUAL' | 'IMPORTED',
    pulledIntoBoardAt:   t.pulledIntoBoardAt?.toISOString() ?? null,
    flaggedForDeletion:  t.flaggedForDeletion,
    deletionFlagNote:    t.deletionFlagNote ?? null,
    deletionFlaggedById: t.deletionFlaggedById ?? null,
    squad:               t.squad,
    assignee:            t.assignee,
    laneName:            t.lane?.name ?? null,
    totalNormalMin:      t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0), 0),
    totalOtMin:          t.timeLogs.reduce((s, l) => s + (l.otMinutes ?? 0), 0),
  }));

  return (
    <>
      <Topbar />
      <TasksClient
        tasks={rows}
        squads={squads}
        users={users}
        userRole={user.role}
        userSquadId={user.squadId ?? null}
        userId={user.id}
        qaEngineers={qaEngineers}
      />
    </>
  );
}
