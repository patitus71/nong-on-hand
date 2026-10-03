import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Topbar from '@/components/Topbar';
import ImportClient from './ImportClient';
import { canAccessSquad } from '@/lib/rbac';

export default async function ImportPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;

  if (!['ADMIN', 'QA_LEAD'].includes(user.role)) redirect('/tasks');

  // QA_LEAD เห็น/เลือกได้เฉพาะ squad ที่ตัวเองเข้าถึงได้ (ADMIN และ floating pool ได้ทุก squad)
  const squads = (await prisma.squad.findMany({
    select:  { id: true, name: true },
    orderBy: { name: 'asc' },
  })).filter(s => canAccessSquad(user, s.id));

  return (
    <>
      <Topbar />
      <ImportClient squads={squads} />
    </>
  );
}
