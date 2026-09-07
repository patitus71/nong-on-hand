import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { canSendLineBroadcast, squadScopeFilter, type SessionUser } from '@/lib/rbac';
import { calcSprintDurationDays } from '@/lib/sprint';
import Topbar from '@/components/Topbar';
import Link from 'next/link';
import BroadcastButtons from './BroadcastButtons';

export default async function SquadsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as SessionUser;
  const canBroadcast = canSendLineBroadcast(user);

  // Floating pool member และ ADMIN/QA_MANAGER เห็น grid selector ทั้งหมด
  // QA_LEAD/QA_ENGINEER ที่ผูก squad แล้ว redirect เข้า squad ตัวเองทันที
  if (user.squadId && !user.isFloatingPoolMember) redirect(`/squads/${user.squadId}`);

  // ADMIN ไม่มี squad → แสดงรายชื่อ squad ทั้งหมดให้เลือก
  const scope = squadScopeFilter(user);
  // Squad.findMany scopes by its own `id`, not `squadId` — translate the shared
  // Task/Sprint-shaped filter accordingly (in practice always `{}` here, since
  // QA_LEAD/QA_ENGINEER never reach this page — see redirect above)
  const squadIdFilter = 'squadId' in scope ? { id: scope.squadId } : {};
  const [squads, boardCounts, pendingCounts, openSprints] = await Promise.all([
    prisma.squad.findMany({
      where:   squadIdFilter,
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: { where: { active: true } } } } },
    }),
    prisma.task.groupBy({
      by: ['squadId'],
      where: { deletedAt: null, pulledIntoBoardAt: { not: null }, squadId: { not: null } },
      _count: { id: true },
    }),
    prisma.task.groupBy({
      by: ['squadId'],
      where: { deletedAt: null, pulledIntoBoardAt: null, squadId: { not: null } },
      _count: { id: true },
    }),
    prisma.sprint.findMany({
      where:  { status: 'OPEN', ...scope },
      select: { squadId: true, name: true, startedAt: true },
    }),
  ]);

  const boardMap       = new Map(boardCounts.map(r  => [r.squadId, r._count.id]));
  const pendingMap     = new Map(pendingCounts.map(r => [r.squadId, r._count.id]));
  const openSprintMap  = new Map(openSprints.map(sp => [sp.squadId, sp]));
  const squadsWithoutOpenSprint = squads.filter(s => !openSprintMap.has(s.id));

  return (
    <>
      <Topbar />
      <div className="px-7 py-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-txt-primary mb-1">เลือก Squad</h1>
            <p className="text-[13px] text-txt-secondary">คลิก squad เพื่อดูบอร์ด</p>
          </div>
          {canBroadcast && <BroadcastButtons />}
        </div>

        {squadsWithoutOpenSprint.length > 0 && (
          <div className="flex items-center gap-2 bg-warning-bg border border-warning/30 text-warning text-[13px] px-3.5 py-2.5 rounded-[6px] mb-5">
            ⚠️ <b className="font-semibold">{squadsWithoutOpenSprint.length} squad</b> ยังไม่ได้เปิด Sprint —{' '}
            {squadsWithoutOpenSprint.map(s => s.name).join(', ')}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          {squads.map(s => {
            const inBoard    = boardMap.get(s.id) ?? 0;
            const pending    = pendingMap.get(s.id) ?? 0;
            const openSprint = openSprintMap.get(s.id);
            return (
              <Link
                key={s.id}
                href={`/squads/${s.id}`}
                className="bg-surface-1 border border-app-border rounded-[10px] px-5 py-4 min-w-[220px] hover:border-accent transition-colors"
              >
                <div className="text-base font-semibold text-txt-primary">{s.name}</div>
                <div className="text-[12px] text-txt-secondary mt-1">
                  {s._count.users} คน · {inBoard} งานในบอร์ด
                </div>
                {pending > 0 && (
                  <div className="text-[11px] text-warning mt-0.5">
                    {pending} รอดึงเข้าบอร์ด
                  </div>
                )}
                {openSprint ? (
                  <div className="flex items-center gap-1.5 bg-success-bg text-success text-[11.5px] font-medium px-2.5 py-1.5 rounded-[7px] mt-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                    Sprint {openSprint.name} · เปิดมา {calcSprintDurationDays(openSprint.startedAt, new Date())} วัน
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 bg-danger-bg text-danger text-[11.5px] font-medium px-2.5 py-1.5 rounded-[7px] mt-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" />
                    ยังไม่เปิด Sprint
                    <span className="ml-auto text-txt-muted font-normal text-[10.5px]">คลิกเข้าไปเปิดได้เลย</span>
                  </div>
                )}
              </Link>
            );
          })}
          {squads.length === 0 && (
            <p className="text-[13px] text-txt-muted">ยังไม่มี squad</p>
          )}
        </div>
      </div>
    </>
  );
}
