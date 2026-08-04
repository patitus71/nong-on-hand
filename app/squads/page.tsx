import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import Link from 'next/link';

export default async function SquadsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as SessionUser;

  // ถ้ามี squad ให้ redirect เข้าไปเลย
  if (user.squadId) redirect(`/squads/${user.squadId}`);

  // ADMIN ไม่มี squad → แสดงรายชื่อ squad ทั้งหมดให้เลือก
  const squads = await prisma.squad.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { users: true, tasks: true } },
    },
  });

  return (
    <>
      <Topbar />
      <div className="max-w-[1180px] mx-auto px-7 py-6">
        <h1 className="text-xl font-semibold text-txt-primary mb-1">เลือก Squad</h1>
        <p className="text-[13px] text-txt-secondary mb-6">คลิก squad เพื่อดูบอร์ด</p>

        <div className="flex gap-3 flex-wrap">
          {squads.map(s => (
            <Link
              key={s.id}
              href={`/squads/${s.id}`}
              className="bg-surface-1 border border-app-border rounded-[10px] px-5 py-4 min-w-[160px] hover:border-accent transition-colors"
            >
              <div className="text-base font-semibold text-txt-primary">{s.name}</div>
              <div className="text-[12px] text-txt-secondary mt-1">
                {s._count.users} คน · {s._count.tasks} งาน
              </div>
            </Link>
          ))}
          {squads.length === 0 && (
            <p className="text-[13px] text-txt-muted">ยังไม่มี squad</p>
          )}
        </div>
      </div>
    </>
  );
}
