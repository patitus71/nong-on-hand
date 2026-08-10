import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { canEditSquadBoard } from '@/lib/rbac';
import type { SessionUser } from '@/lib/rbac';
import Topbar from '@/components/Topbar';
import RetroBoardClient from './RetroBoardClient';

export default async function RetroBoardPage({ params }: { params: { squadId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as SessionUser & { name?: string };

  const squad = await prisma.squad.findUnique({
    where: { id: params.squadId },
    select: { id: true, name: true },
  });
  if (!squad) redirect('/squads');

  if (
    user.role !== 'ADMIN' &&
    user.role !== 'QA_LEAD' &&
    user.role !== 'QA_ENGINEER' &&
    user.squadId !== params.squadId
  ) {
    redirect(user.squadId ? `/squads/${user.squadId}/retro` : '/squads');
  }

  const retros = await prisma.retro.findMany({
    where:   { squadId: params.squadId },
    orderBy: { createdAt: 'desc' },
    include: {
      items: {
        include: {
          author: { select: { id: true, name: true } },
          votes:  { select: { userId: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const retrosData = retros.map(retro => ({
    id:        retro.id,
    title:     retro.title,
    status:    retro.status as string,
    createdAt: retro.createdAt.toISOString(),
    closedAt:  retro.closedAt?.toISOString() ?? null,
    squadName: squad.name,
    items: retro.items.map(item => ({
      id:           item.id,
      content:      item.content,
      category:     item.category as string,
      author:       item.author ? { id: item.author.id, name: item.author.name } : null,
      voteCount:    item.votes.length,
      hasVoted:     item.votes.some(v => v.userId === user.id),
      linkedTaskId: item.linkedTaskId,
    })),
  }));

  const canExport = canEditSquadBoard(user, params.squadId);

  return (
    <>
      <Topbar />
      <RetroBoardClient
        squadId={params.squadId}
        squadName={squad.name}
        userId={user.id}
        retros={retrosData}
        canExport={canExport}
      />
    </>
  );
}
