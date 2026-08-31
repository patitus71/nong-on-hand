// POST /api/squads/[squadId]/sprints — เปิด Sprint ใหม่
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import { canManageSprint } from '@/lib/rbac';
import { canOpenNewSprint } from '@/lib/sprint';

export async function POST(req: NextRequest, { params }: { params: { squadId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session.user as SessionUser;

  if (!canManageSprint(user, params.squadId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const squad = await prisma.squad.findUnique({ where: { id: params.squadId }, select: { id: true } });
  if (!squad) return NextResponse.json({ error: 'Squad not found' }, { status: 404 });

  if (!(await canOpenNewSprint(params.squadId))) {
    return NextResponse.json({ error: 'Squad already has an open sprint' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const name: string = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim()
    : `Sprint ${new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
  const plannedEndDate = body.plannedEndDate ? new Date(body.plannedEndDate) : null;

  const sprint = await prisma.sprint.create({
    data: { squadId: params.squadId, name, ...(plannedEndDate ? { plannedEndDate } : {}) },
    select: { id: true, name: true, status: true, startedAt: true, plannedEndDate: true },
  });

  // ดึงงานค้างจาก sprint เก่าที่ปิดแล้วเข้า sprint ใหม่นี้ — set sprintId อย่างเดียว ห้ามแตะ laneId
  // (สเปค 2.17 เส้นทาง B step 3/5) เฉพาะ Todo/In Progress/Review เท่านั้น (ไม่รวม Done/Cancel —
  // isCancelled ต้อง exclude เพราะ hasIssue ยังเป็น true แต่เป็น terminal state ไม่ใช่งานค้างจริง)
  const carried = await prisma.task.updateMany({
    where: {
      squadId:    params.squadId,
      deletedAt:  null,
      isCancelled: false,
      sprint:     { status: 'CLOSED' },
      NOT:        { lane: { name: 'Done' } },
    },
    data: { sprintId: sprint.id },
  });

  return NextResponse.json({ ...sprint, carriedCount: carried.count }, { status: 201 });
}
