import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { canSendLineBroadcast, type SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import Link from 'next/link';
import BroadcastButtons from './BroadcastButtons';

export default async function SquadsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as SessionUser;
  const canBroadcast = canSendLineBroadcast(user);

  // ถ้ามี squad ให้ redirect เข้าไปเลย
  if (user.squadId) redirect(`/squads/${user.squadId}`);

  // ADMIN ไม่มี squad → แสดงรายชื่อ squad ทั้งหมดให้เลือก
  const [squads, boardCounts, pendingCounts] = await Promise.all([
    prisma.squad.findMany({
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
  ]);

  const boardMap   = new Map(boardCounts.map(r   => [r.squadId, r._count.id]));
  const pendingMap = new Map(pendingCounts.map(r => [r.squadId, r._count.id]));

  return (
    <>
      <Topbar />
      <div className="max-w-[1180px] mx-auto px-7 py-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-txt-primary mb-1">เลือก Squad</h1>
            <p className="text-[13px] text-txt-secondary">คลิก squad เพื่อดูบอร์ด</p>
          </div>
          {canBroadcast && <BroadcastButtons />}
        </div>

        <div className="flex gap-3 flex-wrap">
          {squads.map(s => {
            const inBoard = boardMap.get(s.id) ?? 0;
            const pending = pendingMap.get(s.id) ?? 0;
            return (
              <Link
                key={s.id}
                href={`/squads/${s.id}`}
                className="bg-surface-1 border border-app-border rounded-[10px] px-5 py-4 min-w-[160px] hover:border-accent transition-colors"
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
