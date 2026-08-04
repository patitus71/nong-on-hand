import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Topbar from '@/components/Topbar';
import ImportClient from './ImportClient';

export default async function ImportPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;

  if (!['ADMIN', 'QA_LEAD'].includes(user.role)) redirect('/tasks');

  const squads = await prisma.squad.findMany({
    select:  { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <Topbar />
      <ImportClient squads={squads} />
    </>
  );
}
