import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import SquadBoardClient from './SquadBoardClient';

// Derived status — computed from task data, not from physical squad lane
function getSquadStatus(task: { hasIssue: boolean; laneId: string | null; lane?: { name: string } | null }) {
  if (task.hasIssue)    return 'มีปัญหา';
  if (!task.laneId)     return 'To do';
  if (task.lane?.name === 'Done') return 'Done';
  return 'On-Board';
}

export default async function SquadPage({ params }: { params: { squadId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as SessionUser & { name: string };

  // QA_MANAGER ดูได้ทุก squad (ไม่ผูก squad คงที่) — ADMIN เช่นกัน
  if (user.role !== 'ADMIN' && user.role !== 'QA_MANAGER' && user.squadId !== params.squadId) {
    redirect(user.squadId ? `/squads/${user.squadId}` : '/tasks');
  }

  const squad = await prisma.squad.findUnique({
    where: { id: params.squadId },
    include: { users: { where: { active: true }, select: { id: true, name: true, role: true } } },
  });
  if (!squad) notFound();

  // Fetch ALL tasks in squad (including laneId=null → "To do")
  const tasks = await prisma.task.findMany({
    where: { squadId: params.squadId },
    include: {
      lane:     { select: { name: true } },
      assignee: { select: { id: true, name: true } },
      timeLogs: { select: { normalMinutes: true, otMinutes: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const squads = (user.role === 'ADMIN' || user.role === 'QA_MANAGER')
    ? await prisma.squad.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : [{ id: squad.id, name: squad.name }];

  const canAssign = user.role === 'ADMIN' || user.role === 'QA_LEAD';

  // Group tasks into 4 derived columns
  const COLUMNS = ['To do', 'On-Board', 'Done', 'มีปัญหา'] as const;
  type ColName = typeof COLUMNS[number];
  const grouped: Record<ColName, typeof tasks> = {
    'To do': [], 'On-Board': [], 'Done': [], 'มีปัญหา': [],
  };
  for (const t of tasks) {
    grouped[getSquadStatus(t) as ColName].push(t);
  }

  const lanes = COLUMNS.map(name => ({
    name,
    tasks: grouped[name].map(t => ({
      id:             t.id,
      title:          t.title,
      hasIssue:       t.hasIssue,
      assignee:       t.assignee,
      laneName:       t.lane?.name ?? null,   // personal board lane name (shown in On-Board cards)
      totalNormalMin: t.timeLogs.reduce((s, l) => s + l.normalMinutes, 0),
      totalOtMin:     t.timeLogs.reduce((s, l) => s + l.otMinutes, 0),
    })),
  }));

  const members = squad.users.map(u => ({
    id:        u.id,
    name:      u.name,
    taskCount: tasks.filter(t => t.assignee?.id === u.id).length,
  }));

  return (
    <>
      <Topbar />
      <SquadBoardClient
        currentSquadId={squad.id}
        currentSquadName={squad.name}
        lanes={lanes}
        members={members}
        squads={squads}
        userId={user.id}
        canAssign={canAssign}
      />
    </>
  );
}
