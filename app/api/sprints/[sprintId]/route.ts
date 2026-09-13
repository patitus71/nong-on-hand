// PATCH /api/sprints/[sprintId] — แก้ค่า sprint ที่มีอยู่ (ตอนนี้รองรับเฉพาะ capacityHours)
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import { canManageSprint } from '@/lib/rbac';

export async function PATCH(req: NextRequest, { params }: { params: { sprintId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session.user as SessionUser;

  const sprint = await prisma.sprint.findUnique({
    where: { id: params.sprintId },
    select: { id: true, squadId: true },
  });
  if (!sprint) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });

  if (!canManageSprint(user, sprint.squadId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.capacityHours === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }
  const hours = Number(body.capacityHours);
  if (!Number.isInteger(hours) || hours <= 0) {
    return NextResponse.json({ error: 'capacityHours ต้องเป็นจำนวนเต็มบวก' }, { status: 400 });
  }

  const updated = await prisma.sprint.update({
    where: { id: sprint.id },
    data:  { capacityHours: hours },
    select: { id: true, name: true, status: true, startedAt: true, plannedEndDate: true, capacityHours: true },
  });
  return NextResponse.json(updated);
}
