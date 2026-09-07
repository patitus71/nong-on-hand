import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  // Single point of control for post-login landing pages — see squads/page.tsx's
  // own redirect (QA_LEAD/QA_ENGINEER landing on the grid selector bounce to their
  // own squad board) for the sibling case of routing by role/squad membership.
  const user = session.user as any;
  const { role, squadId, isFloatingPoolMember } = user;

  if (role === 'ADMIN')      redirect('/admin');
  if (role === 'QA_MANAGER') redirect('/tasks');
  // Squad 0 (floating pool) — regardless of role, land on the squad selector,
  // never a fixed squad board, since they aren't tied to one squad.
  if (isFloatingPoolMember)  redirect('/squads');
  // QA_LEAD always has a squad in practice (isSquadRequiredForRole in lib/rbac.ts
  // enforces it at user-creation time) but fall back to the selector defensively.
  if (role === 'QA_LEAD') redirect(squadId ? `/squads/${squadId}` : '/squads');
  if (role === 'QA_ENGINEER') redirect('/my-board');
  redirect('/tasks');
}
