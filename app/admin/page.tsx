import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import AdminClient from './AdminClient';

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const user = session.user as SessionUser;
  if (user.role !== 'ADMIN') redirect('/dashboard');

  return (
    <>
      <Topbar />
      <AdminClient actorRole={user.role} actorId={user.id} />
    </>
  );
}
