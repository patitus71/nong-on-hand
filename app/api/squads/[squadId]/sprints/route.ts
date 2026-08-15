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

  const sprint = await prisma.sprint.create({
    data: { squadId: params.squadId, name },
    select: { id: true, name: true, status: true, startedAt: true },
  });

  return NextResponse.json(sprint, { status: 201 });
}
