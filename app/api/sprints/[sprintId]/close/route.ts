// PATCH /api/sprints/[sprintId]/close — ปิด Sprint
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import { canManageSprint } from '@/lib/rbac';
import { countUnfinishedTasks } from '@/lib/sprint';
import { buildEndOfSprintReport } from '@/lib/squadLineMessages';
import { sendLineTextMessage } from '@/lib/lineNotify';

export async function PATCH(req: NextRequest, { params }: { params: { sprintId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session.user as SessionUser;

  const sprint = await prisma.sprint.findUnique({
    where: { id: params.sprintId },
    select: {
      id: true, squadId: true, status: true,
      squad: { select: { lineGroupId: true } },
    },
  });
  if (!sprint) return NextResponse.json({ error: 'Sprint not found' }, { status: 404 });
  if (sprint.status === 'CLOSED') return NextResponse.json({ error: 'Sprint already closed' }, { status: 409 });

  if (!canManageSprint(user, sprint.squadId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const unfinished = await countUnfinishedTasks(sprint.id);

  const body = await req.json().catch(() => ({}));
  // confirmClose: true ข้าม warning และปิดเลย
  if (unfinished > 0 && !body.confirmClose) {
    return NextResponse.json({ unfinishedCount: unfinished, requiresConfirm: true }, { status: 200 });
  }

  const closed = await prisma.sprint.update({
    where: { id: sprint.id },
    data: { status: 'CLOSED', closedAt: new Date(), closedById: user.id },
    select: { id: true, name: true, status: true, closedAt: true },
  });

  // End of Sprint report — best-effort, must not fail the close itself
  if (sprint.squad.lineGroupId) {
    try {
      const chunks = await buildEndOfSprintReport(closed.id);
      for (const chunk of chunks) {
        const r = await sendLineTextMessage(sprint.squad.lineGroupId, chunk);
        if (!r.success) console.error(`[sprint/close] End of Sprint LINE send failed:`, r.reason);
      }
    } catch (err) {
      console.error('[sprint/close] End of Sprint report error:', err);
    }
  }

  return NextResponse.json(closed);
}
