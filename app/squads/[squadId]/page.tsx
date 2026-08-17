import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import { canApproveReview as canApproveReviewFn, canAssignTaskOnSquadBoard, canCreateTaskOnSquadBoard, canManageSprint } from '@/lib/rbac';
import { computeSquadBoardStatus } from '@/lib/importTasks';
import Topbar from '@/components/Topbar';
import SquadBoardClient from './SquadBoardClient';

export default async function SquadPage({
  params,
  searchParams,
}: {
  params: { squadId: string };
  searchParams: { sprint?: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const user = session.user as SessionUser & { name: string };

  // ADMIN, QA_MANAGER และ floating pool member ดูได้ทุก squad
  if (
    user.role !== 'ADMIN' &&
    user.role !== 'QA_MANAGER' &&
    !user.isFloatingPoolMember &&
    user.squadId !== params.squadId
  ) {
    redirect(user.squadId ? `/squads/${user.squadId}` : '/tasks');
  }

  const [squad, allSquads, sprints] = await Promise.all([
    prisma.squad.findUnique({
      where: { id: params.squadId },
      include: { users: { where: { active: true }, select: { id: true, name: true, role: true } } },
    }),
    (user.role === 'ADMIN' || user.role === 'QA_MANAGER' || user.isFloatingPoolMember)
      ? prisma.squad.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : Promise.resolve(null),
    prisma.sprint.findMany({
      where:   { squadId: params.squadId },
      select:  { id: true, name: true, status: true, startedAt: true, closedAt: true, plannedEndDate: true },
      orderBy: { startedAt: 'desc' },
    }),
  ]);
  if (!squad) notFound();

  const squads = allSquads ?? [{ id: squad.id, name: squad.name }];

  // Determine which sprint to display
  const openSprint   = sprints.find(s => s.status === 'OPEN') ?? null;
  const requestedId  = searchParams.sprint;
  const activeSprint = requestedId
    ? (sprints.find(s => s.id === requestedId) ?? openSprint)
    : openSprint;

  // Only show tasks that belong to the active sprint (null sprint = legacy pre-sprint tasks, hidden)
  const tasks = activeSprint
    ? await prisma.task.findMany({
        where: { squadId: params.squadId, deletedAt: null, sprintId: activeSprint.id },
        include: {
          lane:     { select: { name: true } },
          assignee: { select: { id: true, name: true } },
          timeLogs: { select: { normalMinutes: true, otMinutes: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const canAssign        = canAssignTaskOnSquadBoard(user, params.squadId);
  const canApproveReview = canApproveReviewFn(user, params.squadId);
  const canCreate        = canCreateTaskOnSquadBoard(user, params.squadId);
  const canSprint        = canManageSprint(user, params.squadId);

  // Group tasks into 6 derived columns
  const COLUMNS = ['To do list', 'On-Board', 'On-Board In Progress', 'Wait for review', 'Done', 'มีปัญหา'] as const;
  type ColName = typeof COLUMNS[number];
  const grouped: Record<ColName, typeof tasks> = {
    'To do list': [], 'On-Board': [], 'On-Board In Progress': [], 'Wait for review': [], 'Done': [], 'มีปัญหา': [],
  };
  for (const t of tasks) {
    grouped[computeSquadBoardStatus(t) as ColName].push(t);
  }

  const activePlanEnd = activeSprint?.plannedEndDate ?? null;

  function msPerDay() { return 24 * 60 * 60 * 1000; }
  function daysUntil(d: Date) { return Math.ceil((d.getTime() - Date.now()) / msPerDay()); }

  const lanes = COLUMNS.map(name => ({
    name,
    tasks: grouped[name].map(t => {
      const totalNormalMin = t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0), 0);
      const totalOtMin     = t.timeLogs.reduce((s, l) => s + (l.otMinutes ?? 0), 0);
      const isDone = name === 'Done';
      const reasons: string[] = [];
      if (!isDone && t.estimatedHours && (totalNormalMin + totalOtMin) > t.estimatedHours * 60) {
        reasons.push('เวลาเกิน estimate แล้ว');
      }
      if (!isDone && activePlanEnd) {
        const d = daysUntil(activePlanEnd);
        if (d <= 2) reasons.push(d <= 0 ? 'Sprint เลยกำหนดแล้ว' : `Sprint ปิดใน ${d} วัน`);
      }
      return {
        id:                 t.id,
        title:              t.title,
        hasIssue:           t.hasIssue,
        flaggedForDeletion: t.flaggedForDeletion,
        deletionFlagNote:   t.deletionFlagNote ?? null,
        assignee:           t.assignee,
        laneName:           t.lane?.name ?? null,
        reviewApprovedAt:   t.reviewApprovedAt?.toISOString() ?? null,
        totalNormalMin,
        totalOtMin,
        isAtRisk:           reasons.length > 0,
        riskReason:         reasons.join(' · '),
      };
    }),
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
        userName={user.name}
        canAssign={canAssign}
        canApproveReview={canApproveReview}
        canCreateTask={canCreate}
        canManageSprint={canSprint}
        sprints={sprints.map(s => ({
          id:             s.id,
          name:           s.name,
          status:         s.status as 'OPEN' | 'CLOSED',
          startedAt:      s.startedAt.toISOString(),
          closedAt:       s.closedAt?.toISOString() ?? null,
          plannedEndDate: s.plannedEndDate?.toISOString() ?? null,
        }))}
        activeSprintId={activeSprint?.id ?? null}
        hasOpenSprint={sprints.some(s => s.status === 'OPEN')}
      />
    </>
  );
}
