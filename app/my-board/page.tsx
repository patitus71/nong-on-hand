import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { canCreateTask, type SessionUser } from '@/lib/rbac';
import { PERSONAL_LANE_DEFAULTS } from '@/lib/personalBoard';
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

function personalBoardTasksInclude() {
  return {
    // ticket ที่ถูก cancel (เลน Cancel) แต่ sprint ที่มันสังกัดปิดไปแล้ว ถือว่าจบเรื่องแล้วจริงๆ
    // ไม่ต้องตามหลอนอยู่ใน My Board อีก (ดูย้อนหลังได้ผ่าน export report ตามปกติ) — sprintId เป็น
    // null ก็ยังโชว์ตามเดิม (ไม่เคยผูกกับ sprint ไหนเลย)
    where: {
      NOT: { isCancelled: true, sprint: { status: 'CLOSED' as const } },
    },
    orderBy: [{ order: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      squad:    { select: { name: true } },
      assignee: { select: { id: true, name: true } },
      reviewer: { select: { name: true } },
      timeLogs: { select: { normalMinutes: true, otMinutes: true } },
      sprint:   { select: { plannedEndDate: true } },
    },
  };
}

export default async function MyBoardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const user = session.user as SessionUser & { name: string };

  let board = await prisma.board.findFirst({
    where: { ownerId: user.id, type: 'PERSONAL' },
    include: {
      lanes: {
        orderBy: { order: 'asc' },
        include: { tasks: personalBoardTasksInclude() },
      },
    },
  });

  if (!board) {
    board = await prisma.board.create({
      data: {
        name:    'My Board',
        type:    'PERSONAL',
        ownerId: user.id,
        lanes:   { create: PERSONAL_LANE_DEFAULTS },
      },
      include: {
        lanes: {
          orderBy: { order: 'asc' },
          include: { tasks: personalBoardTasksInclude() },
        },
      },
    });
  } else {
    // Backfill: user เก่าที่สร้าง personal board ไว้ก่อนฟีเจอร์ใหม่ๆ (เช่นเลน Cancel)
    // จะยังไม่มีเลนที่เพิ่งเพิ่มมาทีหลัง — เติมให้อัตโนมัติตอนโหลดหน้า (เหมือน ensureSquadBoard())
    const existingLaneNames = new Set(board.lanes.map(l => l.name));
    const missingLanes = PERSONAL_LANE_DEFAULTS.filter(l => !existingLaneNames.has(l.name));
    if (missingLanes.length > 0) {
      await prisma.lane.createMany({
        data: missingLanes.map(l => ({ ...l, boardId: board!.id })),
      });
      board = await prisma.board.findUnique({
        where:   { id: board.id },
        include: {
          lanes: {
            orderBy: { order: 'asc' },
            include: { tasks: personalBoardTasksInclude() },
          },
        },
      });
    }
  }
  if (!board) throw new Error('Failed to load or create personal board');

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
      reviewer: { select: { name: true } },
      timeLogs: { select: { normalMinutes: true, otMinutes: true } },
      sprint:   { select: { plannedEndDate: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Build reviewer list per squad (QA_LEADs of that squad + floating pool + ADMIN)
  const boardTaskSquadIds = board.lanes.flatMap(l => l.tasks).map(t => t.squadId).filter(Boolean) as string[];
  const rawTaskSquadIds   = rawSquadTasks.map(t => t.squadId).filter(Boolean) as string[];
  const allSquadIds       = Array.from(new Set([...boardTaskSquadIds, ...rawTaskSquadIds]));

  const reviewersBySquad: Record<string, { id: string; name: string }[]> = {};
  if (allSquadIds.length > 0) {
    const reviewerCandidates = await prisma.user.findMany({
      where: {
        active: true, deletedAt: null,
        OR: [
          { role: 'ADMIN' },
          { role: 'QA_LEAD', squadId: { in: allSquadIds } },
          { squad: { isFloatingPool: true } },
        ],
      },
      select: { id: true, name: true, squadId: true, role: true, squad: { select: { isFloatingPool: true } } },
    });
    const floatingAndAdmin = reviewerCandidates.filter(u => u.role === 'ADMIN' || u.squad?.isFloatingPool);
    for (const sid of allSquadIds) {
      const squadLeads = reviewerCandidates.filter(u => u.squadId === sid && !u.squad?.isFloatingPool && u.role !== 'ADMIN');
      reviewersBySquad[sid] = [
        ...squadLeads.map(u => ({ id: u.id, name: u.name })),
        ...floatingAndAdmin.map(u => ({ id: u.id, name: u.name })),
      ];
    }
  }

  // Tasks where I'm the assigned reviewer, still in Review lane, not yet approved
  const rawPendingReviews = await prisma.task.findMany({
    where: { reviewerId: user.id, deletedAt: null, reviewApprovedAt: null, lane: { name: 'Review' } },
    select: {
      id: true, title: true, prLink: true,
      squad:    { select: { id: true, name: true } },
      assignee: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const pendingReviews = rawPendingReviews.map(r => ({
    id:       r.id,
    title:    r.title,
    prLink:   r.prLink,
    squad:    r.squad,
    assignee: r.assignee ? { name: r.assignee.name } : null,
  }));

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
          requiresReview:   t.requiresReview,
          isCancelled:      t.isCancelled,
          cancelNote:       t.cancelNote ?? null,
          reviewerId:       t.reviewerId ?? null,
          reviewerName:     t.reviewer?.name ?? null,
          prLink:           t.prLink ?? null,
          squadId:          t.squadId ?? null,
          squad:            t.squad ? { name: t.squad.name } : null,
          assigneeId:       t.assignee?.id ?? null,
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
          requiresReview:   t.requiresReview,
          isCancelled:      t.isCancelled,
          cancelNote:       t.cancelNote ?? null,
          reviewerId:       t.reviewerId ?? null,
          reviewerName:     t.reviewer?.name ?? null,
          prLink:           t.prLink ?? null,
          squadId:          t.squadId ?? null,
          squad:            t.squad ? { name: t.squad.name } : null,
          assigneeId:       user.id,
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
        reviewersBySquad={reviewersBySquad}
        pendingReviews={pendingReviews}
      />
    </>
  );
}
