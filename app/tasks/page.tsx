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

  const [tasks, squads, users, assignableMembers, openSprints] = await Promise.all([
    prisma.task.findMany({
      where: { deletedAt: null },
      include: {
        squad:    { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        lane:     { select: { name: true } },
        timeLogs: { select: { normalMinutes: true, otMinutes: true } },
      },
      // taskPoint, estimatedHours ดึงมาด้วยเป็น scalar field เริ่มต้นของ findMany อยู่แล้ว
      orderBy: { createdAt: 'desc' },
    }),
    prisma.squad.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({
      where:   { active: true, deletedAt: null },
      select:  { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    // ผู้รับผิดชอบได้ทุกคน (QA_ENGINEER/QA_LEAD — ตรงกับ canAssignTaskTo() ใน lib/importTasks.ts)
    // ดึงมาทั้งหมดพร้อม squadId แล้วให้ TasksClient กรองตาม squad ของงานที่กำลังดึงเข้าบอร์ดเอง
    // (ต้องดึงทุก squad ไม่ใช่แค่ squad ของ user ปัจจุบัน เพราะ ADMIN/floating pool ดึงงานข้าม squad ได้)
    prisma.user.findMany({
      where:   { role: { in: ['QA_ENGINEER', 'QA_LEAD'] }, active: true, deletedAt: null },
      select:  { id: true, name: true, squadId: true },
      orderBy: { name: 'asc' },
    }),
    // OPEN sprints per squad — used in pull-in modal to assign task to a sprint
    prisma.sprint.findMany({
      where:   { status: 'OPEN' },
      select:  { id: true, name: true, squadId: true },
      orderBy: { startedAt: 'desc' },
    }),
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
    taskPoint:           t.taskPoint ?? null,
    estimatedHours:      t.estimatedHours ?? null,
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
        assignableMembers={assignableMembers}
        openSprints={openSprints}
      />
    </>
  );
}
